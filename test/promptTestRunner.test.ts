import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CancellationLike, runPromptTest, statusForExitCode } from "../src/promptTestRunner";
import { repositoryPythonPath } from "../src/repositoryPaths";

const repositories: string[] = [];
const noCancellation: CancellationLike = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined })
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repoRoot) => {
    return fs.rm(repoRoot, { recursive: true, force: true });
  }));
});

describe("prompt test runner", () => {
  it("maps only exit code zero to passed", () => {
    expect(statusForExitCode(0)).toBe("passed");
    expect(statusForExitCode(1)).toBe("failed");
    expect(statusForExitCode(17)).toBe("failed");
  });

  it("passes isolated prompt content and metadata to the configured process", async () => {
    const repoRoot = await createTestRepository(`
      const fs = require("node:fs");
      const content = fs.readFileSync(process.argv[2], "utf8");
      console.log(process.env.PROMPT_HISTORY_SOURCE_PATH + ":" + content);
      process.exit(content === "valid prompt" ? 0 : 2);
    `);
    const result = await runPromptTest(
      {
        repoRoot,
        sourcePath: "prompts/example.prompt.md",
        revision: "abc123",
        content: "valid prompt"
      },
      "tests/validate.py",
      5,
      noCancellation
    );

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prompts/example.prompt.md:valid prompt");
  });

  it("maps a non-zero validator exit to failed", async () => {
    const repoRoot = await createTestRepository("process.exit(3);");
    const result = await runPromptTest(
      { repoRoot, sourcePath: "prompt.md", revision: "", content: "invalid" },
      "tests/validate.py",
      5,
      noCancellation
    );

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
  });

  it("returns an error when the validator exceeds its timeout", async () => {
    const repoRoot = await createTestRepository("setInterval(() => undefined, 1000);");
    const result = await runPromptTest(
      { repoRoot, sourcePath: "prompt.md", revision: "", content: "prompt" },
      "tests/validate.py",
      0.02,
      noCancellation
    );

    expect(result.status).toBe("error");
  });

  it("cancels a running validator", async () => {
    const repoRoot = await createTestRepository("setInterval(() => undefined, 1000);");
    let cancel = (): void => undefined;
    const cancellation: CancellationLike = {
      isCancellationRequested: false,
      onCancellationRequested: (listener) => {
        cancel = listener;
        return { dispose: () => undefined };
      }
    };
    const resultPromise = runPromptTest(
      { repoRoot, sourcePath: "prompt.md", revision: "", content: "prompt" },
      "tests/validate.py",
      5,
      cancellation
    );
    setTimeout(() => cancel(), 20);

    expect((await resultPromise).status).toBe("cancelled");
  });

  it("removes the temporary prompt file after completion", async () => {
    const repoRoot = await createTestRepository("console.log(process.argv[2]);");
    const result = await runPromptTest(
      { repoRoot, sourcePath: "prompt.md", revision: "", content: "prompt" },
      "tests/validate.py",
      5,
      noCancellation
    );

    await expect(fs.access(result.stdout.trim())).rejects.toThrow();
  });

  it("caps validator output", async () => {
    const repoRoot = await createTestRepository(`
      process.stdout.write("x".repeat(1024 * 1024 + 100));
    `);
    const result = await runPromptTest(
      { repoRoot, sourcePath: "prompt.md", revision: "", content: "prompt" },
      "tests/validate.py",
      5,
      noCancellation
    );

    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1024 * 1024);
    expect(result.stderr).not.toBe("");
  });
});

/** Create a disposable repository-shaped fixture with an exact `.venv` interpreter path.
 *
 * Linking the current Node executable provides deterministic child-process behavior without depending on global Python.
 */
async function createTestRepository(script: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-history-runner-test-"));
  const interpreter = repositoryPythonPath(repoRoot);
  const scriptPath = path.join(repoRoot, "tests", "validate.py");
  repositories.push(repoRoot);
  await fs.mkdir(path.dirname(interpreter), { recursive: true });
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.symlink(process.execPath, interpreter);
  await fs.writeFile(scriptPath, script, "utf8");
  return repoRoot;
}
