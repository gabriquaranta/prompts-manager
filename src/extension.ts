import * as vscode from "vscode";
import {
  buildDiffUris,
  buildRevisionDiffUris,
  buildRevisionUri,
  diffScheme,
  PromptDiffProvider
} from "./diffProvider";
import { readFileAtRevision, watchWorkspaceRepositories } from "./git";
import {
  CommitNode,
  FileNode,
  LoadMoreNode,
  PromptHistoryTreeProvider
} from "./tree";

export function activate(context: vscode.ExtensionContext): void {
  const treeProvider = new PromptHistoryTreeProvider(context.workspaceState);
  const diffProvider = new PromptDiffProvider();
  const treeView = vscode.window.createTreeView("promptHistory.commits", {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  let gitWatchers: vscode.Disposable[] = [];

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(diffScheme, diffProvider),
    treeView,
    vscode.commands.registerCommand("promptHistory.refresh", async () => {
      await runAndReport(() => treeProvider.refresh());
    }),
    vscode.commands.registerCommand("promptHistory.search", async () => {
      await runAndReport(() => treeProvider.search());
    }),
    vscode.commands.registerCommand("promptHistory.clearSearch", () => {
      treeProvider.clearFilter();
    }),
    vscode.commands.registerCommand("promptHistory.showFileHistory", async () => {
      await runAndReport(async () => {
        await treeProvider.showFileHistory(vscode.window.activeTextEditor?.document.uri);
      });
    }),
    vscode.commands.registerCommand("promptHistory.openDiff", async (node: FileNode) => {
      await runAndReport(async () => {
        const { left, right, title } = buildDiffUris(diffProvider, node.repoRoot, node.commit, node.file);
        await vscode.commands.executeCommand("vscode.diff", left, right, title);
      });
    }),
    vscode.commands.registerCommand("promptHistory.copyPrompt", async (node: FileNode) => {
      await runAndReport(async () => {
        const revision = treeProvider.getRevision(node);
        const content = await readFileAtRevision(node.repoRoot, revision.revision, revision.path);
        await vscode.env.clipboard.writeText(content);
        vscode.window.showInformationMessage(`Copied ${node.file.path} from ${node.commit.shortHash}`);
      });
    }),
    vscode.commands.registerCommand("promptHistory.openRevision", async (node: FileNode) => {
      await runAndReport(async () => {
        const uri = buildRevisionUri(diffProvider, treeProvider.getRevision(node));
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
      });
    }),
    vscode.commands.registerCommand("promptHistory.compareRevisions", async (node: FileNode) => {
      await runAndReport(async () => {
        const first = treeProvider.getRevision(node);
        const candidates = treeProvider.getComparisonCandidates(node);
        const selected = await vscode.window.showQuickPick(candidates, {
          placeHolder: "Select the second prompt revision"
        });

        if (!selected) {
          return;
        }

        const { left, right, title } = buildRevisionDiffUris(diffProvider, first, selected);
        await vscode.commands.executeCommand("vscode.diff", left, right, title);
      });
    }),
    vscode.commands.registerCommand("promptHistory.loadMore", async (node: LoadMoreNode) => {
      await runAndReport(() => treeProvider.loadMore(node.repoRoot));
    }),
    vscode.commands.registerCommand("promptHistory.toggleBookmark", async (node: CommitNode | FileNode) => {
      await runAndReport(() => treeProvider.toggleBookmark(node));
    }),
    vscode.commands.registerCommand("promptHistory.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "promptHistory");
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("promptHistory")) {
        await runAndReport(() => treeProvider.refresh());
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      gitWatchers.forEach((watcher) => watcher.dispose());
      gitWatchers = [];
      await runAndReport(() => treeProvider.refresh());
      await installGitWatchers();
    })
  );

  const installGitWatchers = async (): Promise<void> => {
    gitWatchers = await watchWorkspaceRepositories(() => {
      void runAndReport(() => treeProvider.refresh());
    });
    context.subscriptions.push(...gitWatchers);
  };

  void runAndReport(() => treeProvider.refresh());
  void installGitWatchers();
}

export function deactivate(): void {
  return;
}

async function runAndReport(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Prompt History: ${message}`);
  }
}
