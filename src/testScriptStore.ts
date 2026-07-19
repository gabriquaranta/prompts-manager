import * as path from "node:path";
import * as vscode from "vscode";
import { resolveRepositoryPath, toRepositoryRelativePath } from "./repositoryPaths";

const stateKey = "testScripts";

export class TestScriptStore {
  constructor(private readonly state: vscode.Memento) {}

  /** Read the configured script for one repository.
   *
   * Repository-keyed storage lets nested repositories select different validators without changing source files.
   */
  get(repoRoot: string): string | undefined {
    return this.state.get<Record<string, string>>(stateKey, {})[path.resolve(repoRoot)];
  }

  /** Persist an exact repository-relative Python script path.
   *
   * Validation at the storage boundary prevents invalid paths from reaching the process runner.
   */
  async set(repoRoot: string, relativePath: string): Promise<void> {
    resolveRepositoryPath(repoRoot, relativePath);

    if (path.extname(relativePath) !== ".py") {
      throw new Error("The test script must be a .py file");
    }

    const scripts = { ...this.state.get<Record<string, string>>(stateKey, {}) };
    scripts[path.resolve(repoRoot)] = relativePath;
    await this.state.update(stateKey, scripts);
  }

  /** Remove the configured script for one repository.
   *
   * Removing only the selected key preserves independent script choices for other workspace repositories.
   */
  async clear(repoRoot: string): Promise<void> {
    const scripts = { ...this.state.get<Record<string, string>>(stateKey, {}) };
    delete scripts[path.resolve(repoRoot)];
    await this.state.update(stateKey, scripts);
  }

  /** Ask the user to select and store a Python file inside a repository.
   *
   * The explicit picker keeps script execution user-directed and avoids filename discovery rules.
   */
  async select(repoRoot: string): Promise<string | undefined> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(repoRoot),
      filters: { Python: ["py"] },
      openLabel: "Select Test Script",
      title: `Select test script for ${path.basename(repoRoot)}`
    });

    if (!selected?.[0]) {
      return undefined;
    }

    const relativePath = toRepositoryRelativePath(repoRoot, selected[0].fsPath);
    await this.set(repoRoot, relativePath);
    return relativePath;
  }
}
