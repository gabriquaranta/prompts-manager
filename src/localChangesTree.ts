import * as path from "node:path";
import * as vscode from "vscode";
import { findPromptWorkingChanges, findWorkspaceRepoRoots } from "./git";
import { isPromptPath } from "./globs";
import { hashPromptContent, mergeUnsavedChanges } from "./localChanges";
import { readSettings } from "./settings";
import { LatestTestResult, MessageNode, TestResultNode, TestScriptNode } from "./tree";
import { PromptTestRequest, PromptTestStatus, PromptWorkingChange } from "./types";

interface WorkingRepository {
  repoRoot: string;
  changes: PromptWorkingChange[];
}

export type WorkingChangesNode =
  | WorkingRepositoryNode
  | WorkingChangeNode
  | TestScriptNode
  | TestResultNode
  | MessageNode;

export class WorkingRepositoryNode extends vscode.TreeItem {
  constructor(readonly repository: WorkingRepository) {
    super(path.basename(repository.repoRoot), vscode.TreeItemCollapsibleState.Collapsed);

    this.description = repository.repoRoot;
    this.tooltip = repository.repoRoot;
    this.contextValue = "promptHistoryWorkingRepository";
    this.iconPath = new vscode.ThemeIcon("repo");
  }

  get repoRoot(): string {
    return this.repository.repoRoot;
  }
}

export class WorkingChangeNode extends vscode.TreeItem {
  constructor(
    readonly repoRoot: string,
    readonly change: PromptWorkingChange,
    testStatus?: PromptTestStatus
  ) {
    super(change.path, vscode.TreeItemCollapsibleState.None);

    const state = workingChangeDescription(change);
    this.description = `${state}${testStatus ? ` • ${statusLabel(testStatus)}` : ""}`;
    this.tooltip = change.oldPath
      ? `${change.oldPath} -> ${change.path}\n${state}`
      : `${change.path}\n${state}`;
    this.contextValue = change.kind === "deleted" && !change.unsaved
      ? "promptHistoryWorkingFileDeleted"
      : "promptHistoryWorkingFile";
    this.iconPath = new vscode.ThemeIcon(testStatus ? statusIcon(testStatus) : workingChangeIcon(change));
    this.resourceUri = vscode.Uri.file(path.join(repoRoot, change.path));
    this.command = {
      command: "promptHistory.openWorkingDiff",
      title: "Open Working Diff",
      arguments: [this]
    };
  }
}

export class WorkingChangesTreeProvider implements vscode.TreeDataProvider<WorkingChangesNode> {
  private readonly changeEmitter = new vscode.EventEmitter<WorkingChangesNode | undefined>();
  private repositories: WorkingRepository[] = [];
  private refreshPromise: Promise<void> | undefined;
  private loaded = false;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly testScriptForRepository: (repoRoot: string) => string | undefined,
    private readonly latestTestForRepository: (repoRoot: string) => LatestTestResult | undefined
  ) {}

  /** Reload local prompt state once for overlapping Git and editor events.
   *
   * Single-flight loading prevents the secondary view from entering a continuous refresh loop.
   */
  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.loadRepositories();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  /** Refresh only configuration and result decorations.
   *
   * Shared test state changes do not require another Git status process.
   */
  refreshTestState(): void {
    this.changeEmitter.fire(undefined);
  }

  /** Return the exact current content represented by a working-change node.
   *
   * Dirty editor buffers take precedence over disk so test and copy actions use what the user sees.
   */
  async getContent(node: WorkingChangeNode): Promise<string> {
    if (node.change.kind === "deleted" && !node.change.unsaved) {
      throw new Error(`${node.change.path} is deleted and has no current content`);
    }

    return readCurrentContent(node.repoRoot, node.change.path);
  }

  /** Build a current-content test request for one working prompt.
   *
   * The content hash makes result decoration disappear as soon as the prompt changes.
   */
  async getTestRequest(node: WorkingChangeNode): Promise<PromptTestRequest> {
    const content = await this.getContent(node);

    return {
      repoRoot: node.repoRoot,
      sourcePath: node.change.path,
      revision: "",
      content,
      contentHash: hashPromptContent(content)
    };
  }

  /** Return every repository currently represented by this provider.
   *
   * Repository-scoped commands reuse this inventory when invoked from Working Changes.
   */
  getRepositoryRoots(): string[] {
    return this.repositories.map((repository) => repository.repoRoot);
  }

  getTreeItem(element: WorkingChangesNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WorkingChangesNode): Promise<WorkingChangesNode[]> {
    if (!this.loaded) {
      await this.refresh();
    }

    if (element instanceof WorkingRepositoryNode) {
      return this.childrenForRepository(element.repository);
    }

    if (this.repositories.length === 0) {
      return [new MessageNode("No active Git repository found")];
    }

    const changed = this.repositories.filter((repository) => repository.changes.length > 0);

    if (changed.length === 0) {
      if (this.repositories.length === 1) {
        return this.childrenForRepository(this.repositories[0]);
      }

      return [new MessageNode("No local prompt changes found")];
    }

    if (changed.length === 1) {
      return this.childrenForRepository(changed[0]);
    }

    return changed.map((repository) => new WorkingRepositoryNode(repository));
  }

  /** Load Git state, merge dirty editors, and hash the current visible content.
   *
   * Normalizing in one pass gives the tree one node and one content identity per prompt path.
   */
  private async loadRepositories(): Promise<void> {
    try {
      const roots = await findWorkspaceRepoRoots();
      const settings = readSettings();
      this.repositories = await Promise.all(roots.map(async (repoRoot) => {
        const gitChanges = await findPromptWorkingChanges(repoRoot, settings);
        const dirtyPaths = vscode.workspace.textDocuments
          .filter((document) => {
            return document.isDirty && document.uri.scheme === "file" && isFileInRepository(document.uri.fsPath, repoRoot);
          })
          .map((document) => path.relative(repoRoot, document.uri.fsPath).replaceAll(path.sep, "/"))
          .filter((relativePath) => isPromptPath(relativePath, settings));
        const changes = mergeUnsavedChanges(gitChanges, dirtyPaths);
        const withHashes = await Promise.all(changes.map(async (change) => {
          if (change.kind === "deleted" && !change.unsaved) {
            return change;
          }

          const content = await readCurrentContent(repoRoot, change.path);
          return { ...change, contentHash: hashPromptContent(content) };
        }));

        return { repoRoot, changes: withHashes };
      }));
    } finally {
      this.loaded = true;
      this.changeEmitter.fire(undefined);
    }
  }

  /** Build shared test rows followed by exact current prompt changes.
   *
   * Keeping test controls first matches the existing History layout and makes results visible without notifications.
   */
  private childrenForRepository(repository: WorkingRepository): WorkingChangesNode[] {
    const scriptPath = this.testScriptForRepository(repository.repoRoot);
    const latest = this.latestTestForRepository(repository.repoRoot);
    const children: WorkingChangesNode[] = [
      new TestScriptNode(repository.repoRoot, scriptPath),
      new TestResultNode(repository.repoRoot, latest),
      ...repository.changes.map((change) => {
        const testStatus = currentTestStatus(change, latest, scriptPath);
        return new WorkingChangeNode(repository.repoRoot, change, testStatus);
      })
    ];

    if (repository.changes.length === 0) {
      children.push(new MessageNode("No local prompt changes found"));
    }

    return children;
  }
}

/** Read the current editor buffer or fall back to the UTF-8 working file.
 *
 * This exact precedence keeps diffs, tests, and copies aligned with visible unsaved edits.
 */
export async function readCurrentContent(repoRoot: string, relativePath: string): Promise<string> {
  const filePath = path.join(repoRoot, relativePath);
  const document = vscode.workspace.textDocuments.find((candidate) => {
    return candidate.uri.scheme === "file" && candidate.uri.fsPath === filePath;
  });

  if (document) {
    return document.getText();
  }

  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  return Buffer.from(bytes).toString("utf8");
}

/** Match a latest result to the exact current file content and selected script.
 *
 * Any content or script change removes stale status from the Working Changes node.
 */
function currentTestStatus(
  change: PromptWorkingChange,
  latest: LatestTestResult | undefined,
  scriptPath: string | undefined
): PromptTestStatus | undefined {
  if (!latest || !scriptPath || !change.contentHash) {
    return undefined;
  }

  return latest.scriptPath === scriptPath &&
    latest.request.sourcePath === change.path &&
    latest.request.contentHash === change.contentHash
    ? latest.result.status
    : undefined;
}

/** Format Git and editor state without inventing alternate status aliases.
 *
 * A concise ordered label makes combined staged, working-tree, and unsaved state visible on one row.
 */
function workingChangeDescription(change: PromptWorkingChange): string {
  const labels = [kindLabel(change)];

  if (change.staged) {
    labels.push("Staged");
  }

  if (change.workingTree && !change.untracked) {
    labels.push("Working Tree");
  }

  if (change.unsaved) {
    labels.push("Unsaved");
  }

  return labels.join(" • ");
}

/** Return the display label for one normalized working-change kind.
 *
 * Exact normalized kinds keep the UI independent of raw Git status characters.
 */
function kindLabel(change: PromptWorkingChange): string {
  return change.kind.charAt(0).toUpperCase() + change.kind.slice(1);
}

/** Return a stable icon for one working-change kind.
 *
 * Standard codicons make local state scannable without custom image assets.
 */
function workingChangeIcon(change: PromptWorkingChange): string {
  if (change.kind === "deleted") {
    return "diff-removed";
  }

  if (change.kind === "added" || change.kind === "untracked") {
    return "diff-added";
  }

  if (change.kind === "renamed") {
    return "diff-renamed";
  }

  return "diff-modified";
}

/** Format a test result status for a local file row.
 *
 * The same capitalization is used by shared result rows in History.
 */
function statusLabel(status: PromptTestStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Return the standard codicon for a local prompt test result.
 *
 * Reusing the History status vocabulary makes both views visually consistent.
 */
function statusIcon(status: PromptTestStatus): string {
  if (status === "passed") {
    return "pass-filled";
  }

  if (status === "failed") {
    return "error";
  }

  if (status === "cancelled") {
    return "circle-slash";
  }

  return "warning";
}

/** Determine whether a file is inside one exact repository root.
 *
 * Relative containment avoids matching sibling repositories with similar path prefixes.
 */
function isFileInRepository(filePath: string, repoRoot: string): boolean {
  const relative = path.relative(repoRoot, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
