import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { repositoryPythonPath, resolveRepositoryPath } from "./repositoryPaths";
import { PromptTestRequest, PromptTestResult } from "./types";

const maxOutputBytes = 1024 * 1024;

export interface CancellationLike {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/** Map a completed process exit code to the public test status.
 *
 * Exit codes are the sole pass/fail protocol so scripts work identically inside the extension and CI.
 */
export function statusForExitCode(exitCode: number): "passed" | "failed" {
  return exitCode === 0 ? "passed" : "failed";
}

/** Run one repository-owned Python validator against isolated prompt content.
 *
 * Temporary-file isolation tests historical content without mutating the working tree and guarantees cleanup afterward.
 */
export async function runPromptTest(
  request: PromptTestRequest,
  scriptRelativePath: string,
  timeoutSeconds: number,
  cancellation: CancellationLike
): Promise<PromptTestResult> {
  const scriptPath = resolveRepositoryPath(request.repoRoot, scriptRelativePath);
  const interpreterPath = repositoryPythonPath(request.repoRoot);
  await requireFile(scriptPath, `Test script does not exist: ${scriptRelativePath}`);
  await requireFile(interpreterPath, `Repository Python does not exist: ${interpreterPath}`);

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-history-"));
  const promptPath = path.join(temporaryDirectory, "prompt.txt");

  try {
    await fs.writeFile(promptPath, request.content, "utf8");
    return await executeTestProcess(interpreterPath, scriptPath, promptPath, request, timeoutSeconds, cancellation);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** Require an exact regular file before starting the child process.
 *
 * Early validation produces a precise configuration error instead of an ambiguous spawn failure.
 */
async function requireFile(filePath: string, message: string): Promise<void> {
  let stats;

  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new Error(message);
  }

  if (!stats.isFile()) {
    throw new Error(message);
  }
}

/** Execute the validator and capture its bounded diagnostic output.
 *
 * Direct spawning avoids shell interpretation while cancellation and timeout keep the extension host responsive.
 */
async function executeTestProcess(
  interpreterPath: string,
  scriptPath: string,
  promptPath: string,
  request: PromptTestRequest,
  timeoutSeconds: number,
  cancellation: CancellationLike
): Promise<PromptTestResult> {
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let capturedBytes = 0;
  let truncated = false;
  const child = spawn(interpreterPath, [scriptPath, promptPath], {
    cwd: request.repoRoot,
    env: {
      ...process.env,
      PROMPT_HISTORY_REPO_ROOT: request.repoRoot,
      PROMPT_HISTORY_SOURCE_PATH: request.sourcePath,
      PROMPT_HISTORY_REVISION: request.revision
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  /** Append output until the shared byte limit is reached.
   *
   * Bounded capture prevents a noisy validator from exhausting extension-host memory.
   */
  const capture = (target: "stdout" | "stderr", chunk: Buffer): void => {
    const remaining = maxOutputBytes - capturedBytes;

    if (remaining <= 0) {
      truncated = true;
      return;
    }

    const accepted = chunk.subarray(0, remaining);
    capturedBytes += accepted.byteLength;
    truncated ||= accepted.byteLength < chunk.byteLength;

    if (target === "stdout") {
      stdout += accepted.toString("utf8");
    } else {
      stderr += accepted.toString("utf8");
    }
  };

  child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));

  const result = await new Promise<PromptTestResult>((resolve) => {
    let settled = false;
    let forcedStatus: PromptTestResult["status"] | undefined;
    let forcedError: string | undefined;

    /** Complete the process once and release timeout and cancellation resources.
     *
     * Centralized settlement prevents close, error, timeout, and cancellation races from reporting twice.
     */
    const finish = (status: PromptTestResult["status"], exitCode?: number, errorMessage?: string): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      cancellationDisposable.dispose();

      if (errorMessage) {
        stderr += `${stderr ? "\n" : ""}${errorMessage}`;
      }

      if (truncated) {
        stderr += `${stderr ? "\n" : ""}[output truncated at ${maxOutputBytes} bytes]`;
      }

      resolve({ status, exitCode, durationMs: Date.now() - startedAt, stdout, stderr });
    };

    const timeout = setTimeout(() => {
      forcedStatus = "error";
      forcedError = `Test timed out after ${timeoutSeconds} seconds`;
      child.kill();
    }, timeoutSeconds * 1000);
    const cancellationDisposable = cancellation.onCancellationRequested(() => {
      forcedStatus = "cancelled";
      child.kill();
    });

    child.once("error", (error) => finish("error", undefined, error.message));
    child.once("close", (code) => {
      const exitCode = code ?? 1;
      finish(forcedStatus ?? statusForExitCode(exitCode), forcedStatus ? undefined : exitCode, forcedError);
    });

    if (cancellation.isCancellationRequested) {
      forcedStatus = "cancelled";
      child.kill();
    }
  });

  return result;
}
