import { execFile } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { gitLogFormat, paginatePromptCommits, parseGitLog } from "./gitLogParser";
import { isPromptPath } from "./globs";
import { PromptCommitPage, PromptHistorySettings } from "./types";

interface GitRepository {
  rootUri: vscode.Uri;
  state?: {
    onDidChange: vscode.Event<void>;
  };
}

interface GitApi {
  repositories: readonly GitRepository[];
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

/** Finds each distinct Git repository represented by the active workspace.
 * It includes the active editor repository first so single-root behavior remains stable.
 */
export async function findWorkspaceRepoRoots(): Promise<string[]> {
  const repositories = await findWorkspaceRepositories();
  const activeFile = vscode.window.activeTextEditor?.document.uri;
  const roots = repositories.map((repository) => repository.rootUri.fsPath);

  if (activeFile?.scheme !== "file") {
    return roots;
  }

  return roots.sort((left, right) => {
    const leftIsActive = isFileInRepository(activeFile.fsPath, left);
    const rightIsActive = isFileInRepository(activeFile.fsPath, right);

    return Number(rightIsActive) - Number(leftIsActive);
  });
}

export async function findPromptCommits(
  repoRoot: string,
  settings: PromptHistorySettings,
  offset = 0
): Promise<PromptCommitPage> {
  const output = await git(repoRoot, [
    "log",
    `--skip=${offset}`,
    `--max-count=${settings.maxCommits + 1}`,
    "--name-status",
    "--date=short",
    `--format=${gitLogFormat}`
  ]);

  const page = paginatePromptCommits(parseGitLog(output), settings.maxCommits, offset);
  const commits = page.commits
    .map((commit) => ({
      ...commit,
      files: commit.files.filter((file) => {
        return isPromptPath(file.path, settings) || (file.oldPath ? isPromptPath(file.oldPath, settings) : false);
      })
    }))
    .filter((commit) => commit.files.length > 0);

  return { ...page, commits };
}

export async function findWorkspaceRepositories(): Promise<readonly GitRepository[]> {
  const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");

  if (!gitExtension) {
    return [];
  }

  const gitApi = gitExtension.isActive
    ? gitExtension.exports
    : await gitExtension.activate();

  return gitApi.getAPI(1).repositories;
}

export async function watchWorkspaceRepositories(
  callback: () => void
): Promise<vscode.Disposable[]> {
  const repositories = await findWorkspaceRepositories();

  return repositories.flatMap((repository) => {
    return repository.state ? [repository.state.onDidChange(callback)] : [];
  });
}

export async function readFileAtRevision(repoRoot: string, revision: string, relativePath: string): Promise<string> {
  return git(repoRoot, ["show", `${revision}:${relativePath}`]);
}

function isFileInRepository(filePath: string, repositoryRoot: string): boolean {
  const relativePath = path.relative(repositoryRoot, filePath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function git(repoRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      resolve(stdout);
    });
  });
}
