import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  repositoryPythonPath,
  resolveRepositoryPath,
  toRepositoryRelativePath
} from "../src/repositoryPaths";

describe("repository paths", () => {
  it("resolves contained files and returns portable relative paths", () => {
    const repoRoot = path.resolve("workspace", "repo");
    const filePath = path.join(repoRoot, "tests", "validate.py");

    expect(resolveRepositoryPath(repoRoot, "tests/validate.py")).toBe(filePath);
    expect(toRepositoryRelativePath(repoRoot, filePath)).toBe("tests/validate.py");
  });

  it("rejects traversal, absolute paths, and the repository root", () => {
    const repoRoot = path.resolve("workspace", "repo");

    expect(() => resolveRepositoryPath(repoRoot, "../other.py")).toThrow();
    expect(() => resolveRepositoryPath(repoRoot, path.resolve("other.py"))).toThrow();
    expect(() => resolveRepositoryPath(repoRoot, ".")).toThrow();
  });

  it("uses the exact platform-specific repository virtual environment", () => {
    expect(repositoryPythonPath("/repo", "linux")).toBe(path.join("/repo", ".venv", "bin", "python"));
    expect(repositoryPythonPath("C:\\repo", "win32")).toBe("C:\\repo\\.venv\\Scripts\\python.exe");
  });
});
