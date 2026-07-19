import * as path from "node:path";

/** Resolve a repository-relative path and reject paths outside the repository.
 *
 * The containment check prevents selected scripts and restored prompts from escaping their owning repository.
 */
export function resolveRepositoryPath(repoRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error("Expected a repository-relative path");
  }

  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the repository: ${relativePath}`);
  }

  return resolved;
}

/** Convert an absolute repository file path into a portable stored path.
 *
 * The normalized slash format keeps workspace state stable across VS Code path rendering differences.
 */
export function toRepositoryRelativePath(repoRoot: string, filePath: string): string {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(filePath));

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Select a file inside the repository");
  }

  return relative.split(path.sep).join("/");
}

/** Return the exact virtual-environment Python path for a repository.
 *
 * A deterministic repository-owned interpreter avoids executing a different global Python by accident.
 */
export function repositoryPythonPath(repoRoot: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? path.win32.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
}
