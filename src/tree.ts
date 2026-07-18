import * as path from "node:path";
import * as vscode from "vscode";
import { findPromptCommits, findWorkspaceRepoRoots } from "./git";
import { matchesPromptCommit } from "./search";
import { readSettings } from "./settings";
import {
  PromptCommit,
  PromptFileChange,
  PromptHistoryFilter,
  PromptRevision
} from "./types";

export type PromptHistoryNode = CommitNode | FileNode | MessageNode | RepoNode | LoadMoreNode;

export class CommitNode extends vscode.TreeItem {
  constructor(
    readonly repoRoot: string,
    readonly commit: PromptCommit,
    readonly bookmarked: boolean
  ) {
    super(`${commit.shortHash} ${commit.subject}`, vscode.TreeItemCollapsibleState.Collapsed);

    this.description = `${commit.author}, ${commit.date}${bookmarked ? " • Pinned" : ""}`;
    this.tooltip = `${commit.hash}\n${commit.subject}\n${commit.author}, ${commit.date}`;
    this.contextValue = "promptHistoryCommit";
    this.iconPath = new vscode.ThemeIcon(bookmarked ? "pinned" : "git-commit");
  }
}

export class FileNode extends vscode.TreeItem {
  constructor(
    readonly repoRoot: string,
    readonly commit: PromptCommit,
    readonly file: PromptFileChange,
    readonly bookmarked: boolean
  ) {
    super(file.path, vscode.TreeItemCollapsibleState.None);

    this.description = `${statusLabel(file)}${bookmarked ? " • Pinned" : ""}`;
    this.tooltip = file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
    this.contextValue = "promptHistoryFile";
    this.iconPath = new vscode.ThemeIcon(bookmarked ? "pinned" : "file-code");
    this.command = {
      command: "promptHistory.openDiff",
      title: "Open Diff",
      arguments: [this]
    };
    this.resourceUri = vscode.Uri.file(path.basename(file.path));
  }
}

export class RepoNode extends vscode.TreeItem {
  hasMore: boolean;
  nextOffset: number;

  constructor(
    readonly repoRoot: string,
    readonly commits: PromptCommit[],
    hasMore: boolean,
    nextOffset: number
  ) {
    super(path.basename(repoRoot), vscode.TreeItemCollapsibleState.Collapsed);
    this.hasMore = hasMore;
    this.nextOffset = nextOffset;

    this.description = repoRoot;
    this.tooltip = repoRoot;
    this.contextValue = "promptHistoryRepository";
    this.iconPath = new vscode.ThemeIcon("repo");
  }
}

export class LoadMoreNode extends vscode.TreeItem {
  constructor(readonly repoRoot: string) {
    super("Load more history", vscode.TreeItemCollapsibleState.None);

    this.contextValue = "promptHistoryLoadMore";
    this.iconPath = new vscode.ThemeIcon("ellipsis");
    this.command = {
      command: "promptHistory.loadMore",
      title: "Load More History",
      arguments: [this]
    };
  }
}

export class MessageNode extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon("info");
  }
}

export class PromptHistoryTreeProvider implements vscode.TreeDataProvider<PromptHistoryNode> {
  private readonly changeEmitter = new vscode.EventEmitter<PromptHistoryNode | undefined>();
  private repositories: RepoNode[] = [];
  private hasGitRepositories = false;
  private refreshPromise: Promise<void> | undefined;
  private loaded = false;
  private filter: PromptHistoryFilter = { query: "" };
  private readonly bookmarks: Set<string>;
  private readonly bookmarkState: vscode.Memento;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(bookmarkState: vscode.Memento) {
    this.bookmarkState = bookmarkState;
    this.bookmarks = new Set(bookmarkState.get<string[]>("bookmarks", []));
  }

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

  async loadMore(repoRoot: string): Promise<void> {
    const repository = this.repositories.find((candidate) => candidate.repoRoot === repoRoot);

    if (!repository || !repository.hasMore) {
      return;
    }

    const page = await findPromptCommits(repoRoot, readSettings(), repository.nextOffset);
    repository.commits.push(...page.commits);
    repository.hasMore = page.hasMore;
    repository.nextOffset = page.nextOffset;
    this.changeEmitter.fire(undefined);
  }

  async search(): Promise<void> {
    const value = await vscode.window.showInputBox({
      prompt: "Search prompt history",
      placeHolder: "terms, author:Ada, status:M, after:2026-01-01",
      value: this.filter.query
    });

    if (value === undefined) {
      return;
    }

    this.filter = { query: value };
    this.changeEmitter.fire(undefined);
  }

  clearFilter(): void {
    this.filter = { query: "" };
    this.changeEmitter.fire(undefined);
  }

  async showFileHistory(fileUri: vscode.Uri | undefined): Promise<void> {
    if (!this.loaded) {
      await this.refresh();
    }

    if (!fileUri || fileUri.scheme !== "file") {
      throw new Error("Open a prompt file before showing its history");
    }

    const repositoryRoot = (await findWorkspaceRepoRoots())
      .find((root) => isFileInRepository(fileUri.fsPath, root));

    if (!repositoryRoot) {
      throw new Error("The active file is not inside a discovered Git repository");
    }

    this.filter = {
      query: "",
      filePath: path.relative(repositoryRoot, fileUri.fsPath).replaceAll(path.sep, "/"),
      repositoryRoot
    };
    this.changeEmitter.fire(undefined);
  }

  toggleBookmark(node: CommitNode | FileNode): Promise<void> {
    const key = bookmarkKey(node);

    if (this.bookmarks.has(key)) {
      this.bookmarks.delete(key);
    } else {
      this.bookmarks.add(key);
    }

    return Promise.resolve(this.bookmarkState.update("bookmarks", [...this.bookmarks])).then(() => {
      this.changeEmitter.fire(undefined);
    });
  }

  getRevision(node: FileNode): PromptRevision {
    return revisionForFile(node.repoRoot, node.commit, node.file);
  }

  getComparisonCandidates(node: FileNode): PromptRevision[] {
    const candidatePath = node.file.path;
    const candidates = this.repositories.flatMap((repository) => repository.commits.flatMap((commit) => {
      return commit.files
        .filter((file) => repository.repoRoot === node.repoRoot && (file.path === candidatePath || file.oldPath === candidatePath))
        .map((file) => revisionForFile(repository.repoRoot, commit, file));
    }));

    candidates.push({
      repoRoot: node.repoRoot,
      revision: "",
      path: candidatePath,
      label: "Current working file",
      workingTree: true
    });

    return candidates.filter((candidate) => {
      return candidate.revision !== node.commit.hash || candidate.path !== node.file.path;
    });
  }

  isBookmarked(node: CommitNode | FileNode): boolean {
    return this.bookmarks.has(bookmarkKey(node));
  }

  getFilter(): PromptHistoryFilter {
    return this.filter;
  }

  private async loadRepositories(): Promise<void> {
    try {
      const roots = await findWorkspaceRepoRoots();
      this.hasGitRepositories = roots.length > 0;
      const settings = readSettings();
      const repositories = await Promise.all(roots.map(async (repoRoot) => {
        const page = await findPromptCommits(repoRoot, settings);
        return new RepoNode(repoRoot, page.commits, page.hasMore, page.nextOffset);
      }));

      this.repositories = repositories.filter((repository) => {
        return repository.commits.length > 0 || repository.hasMore;
      });
    } finally {
      this.loaded = true;
      this.changeEmitter.fire(undefined);
    }
  }

  getTreeItem(element: PromptHistoryNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PromptHistoryNode): Promise<PromptHistoryNode[]> {
    if (!this.loaded) {
      await this.refresh();
    }

    if (element instanceof RepoNode) {
      return this.childrenForRepository(element);
    }

    if (element instanceof CommitNode) {
      return element.commit.files.map((file) => {
        return new FileNode(element.repoRoot, element.commit, file, this.bookmarks.has(fileBookmarkKey(element.repoRoot, element.commit, file)));
      });
    }

    if (this.repositories.length === 0) {
      return [new MessageNode(this.hasGitRepositories ? "No prompt commits found" : "No active Git repository found")];
    }

    const visibleRepositories = this.repositories.filter((repository) => {
      return this.visibleCommits(repository).length > 0 || repository.hasMore;
    });

    if (visibleRepositories.length === 0) {
      return [new MessageNode("No prompt history matches the current filter")];
    }

    if (visibleRepositories.length === 1) {
      return this.childrenForRepository(visibleRepositories[0]);
    }

    return visibleRepositories;
  }

  private childrenForRepository(repository: RepoNode): PromptHistoryNode[] {
    const commits = this.visibleCommits(repository);
    const children: PromptHistoryNode[] = commits.map((commit) => {
      return new CommitNode(repository.repoRoot, commit, this.bookmarks.has(commitBookmarkKey(repository.repoRoot, commit)));
    });

    if (repository.hasMore) {
      children.push(new LoadMoreNode(repository.repoRoot));
    }

    if (children.length === 0) {
      return [new MessageNode("No prompt history matches the current filter")];
    }

    return children;
  }

  private visibleCommits(repository: RepoNode): PromptCommit[] {
    return repository.commits.filter((commit) => {
      return (!this.filter.repositoryRoot || this.filter.repositoryRoot === repository.repoRoot) &&
        matchesPromptCommit(commit, repository.repoRoot, this.filter);
    });
  }
}

function statusLabel(file: PromptFileChange): string {
  if (file.status === "A") {
    return "Added";
  }

  if (file.status === "D") {
    return "Deleted";
  }

  if (file.status === "R") {
    return "Renamed";
  }

  return "Modified";
}

function isFileInRepository(filePath: string, repositoryRoot: string): boolean {
  const relativePath = path.relative(repositoryRoot, filePath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function commitBookmarkKey(repoRoot: string, commit: PromptCommit): string {
  return `commit\0${repoRoot}\0${commit.hash}`;
}

function fileBookmarkKey(repoRoot: string, commit: PromptCommit, file: PromptFileChange): string {
  return `file\0${repoRoot}\0${commit.hash}\0${file.path}`;
}

function bookmarkKey(node: CommitNode | FileNode): string {
  return node instanceof CommitNode
    ? commitBookmarkKey(node.repoRoot, node.commit)
    : fileBookmarkKey(node.repoRoot, node.commit, node.file);
}

function revisionForFile(repoRoot: string, commit: PromptCommit, file: PromptFileChange): PromptRevision {
  const deleted = file.status === "D";

  return {
    repoRoot,
    revision: deleted ? `${commit.hash}^` : commit.hash,
    path: deleted ? file.oldPath ?? file.path : file.path,
    label: `${commit.shortHash} ${commit.subject}`
  };
}
