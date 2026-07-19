import * as path from "node:path";
import * as vscode from "vscode";
import {
  buildDiffUris,
  buildRevisionDiffUris,
  buildRevisionUri,
  diffScheme,
  PromptDiffProvider
} from "./diffProvider";
import { findWorkspaceRepoRoots, readFileAtRevision, watchWorkspaceRepositories } from "./git";
import { isPromptPath } from "./globs";
import { PromptLoader } from "./promptLoader";
import { runPromptTest } from "./promptTestRunner";
import { toRepositoryRelativePath } from "./repositoryPaths";
import { readSettings } from "./settings";
import { TestScriptStore } from "./testScriptStore";
import {
  CommitNode,
  FileNode,
  LoadMoreNode,
  PromptHistoryTreeProvider,
  RepoNode
} from "./tree";
import { PromptTestRequest, PromptTestResult } from "./types";

/** Activate Prompt Management and register its history, restore, and test commands.
 *
 * Central orchestration keeps Git, file mutation, and process execution behind separate focused services.
 */
export function activate(context: vscode.ExtensionContext): void {
  const testScriptStore = new TestScriptStore(context.workspaceState);
  const treeProvider = new PromptHistoryTreeProvider(
    context.workspaceState,
    (repoRoot) => testScriptStore.get(repoRoot)
  );
  const diffProvider = new PromptDiffProvider();
  const promptLoader = new PromptLoader(diffProvider);
  const output = vscode.window.createOutputChannel("Prompt History Tests");
  const activeTests = new Set<string>();
  const treeView = vscode.window.createTreeView("promptHistory.commits", {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  let gitWatchers: vscode.Disposable[] = [];

  /** Resolve a context-menu argument or the current History selection to a prompt revision node.
   *
   * Supporting the selected node keeps revision commands safe when invoked from the Command Palette.
   */
  const selectedFileNode = (node: FileNode | undefined): FileNode => {
    const selected = node ?? treeView.selection[0];

    if (!(selected instanceof FileNode)) {
      throw new Error("Select a prompt-file revision in History first");
    }

    return selected;
  };

  /** Run a configured validator and present one consistent result in the tree, output, and notifications.
   *
   * Repository-level serialization prevents concurrent validators from competing for project-owned resources.
   */
  const executeTest = async (request: PromptTestRequest): Promise<PromptTestResult | undefined> => {
    requireTrustedWorkspace();

    if (activeTests.has(request.repoRoot)) {
      throw new Error(`A prompt test is already running in ${request.repoRoot}`);
    }

    const scriptPath = testScriptStore.get(request.repoRoot);

    if (!scriptPath) {
      const selection = await vscode.window.showInformationMessage(
        `No test script is configured for ${path.basename(request.repoRoot)}`,
        "Select Test Script"
      );

      if (selection === "Select Test Script") {
        const selected = await testScriptStore.select(request.repoRoot);
        treeProvider.setTestScript(request.repoRoot, selected);
      }

      return undefined;
    }

    activeTests.add(request.repoRoot);
    let result: PromptTestResult;

    try {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Testing ${request.sourcePath}`,
          cancellable: true
        },
        async (_progress, token) => {
          try {
            return await runPromptTest(
              request,
              scriptPath,
              readSettings().testTimeoutSeconds,
              token
            );
          } catch (error) {
            return {
              status: "error",
              durationMs: 0,
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error)
            };
          }
        }
      );
    } finally {
      activeTests.delete(request.repoRoot);
    }

    treeProvider.setTestResult(request, scriptPath, result);
    writeTestOutput(output, request, scriptPath, result);
    showTestResult(output, request, result);
    return result;
  };

  /** Load the selected historical node into its exact working-tree path.
   *
   * Reusing the tree provider's revision mapping preserves deleted and renamed file semantics.
   */
  const loadNode = async (node: FileNode): Promise<vscode.TextDocument | undefined> => {
    const revision = treeProvider.getRevision(node);
    const content = await readFileAtRevision(node.repoRoot, revision.revision, revision.path);
    return promptLoader.load(revision, node.file.path, content);
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(diffScheme, diffProvider),
    treeView,
    output,
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
    vscode.commands.registerCommand("promptHistory.loadRevision", async (node?: FileNode) => {
      await runAndReport(async () => {
        await loadNode(selectedFileNode(node));
      });
    }),
    vscode.commands.registerCommand("promptHistory.testRevision", async (node?: FileNode) => {
      await runAndReport(async () => {
        const selected = selectedFileNode(node);
        const revision = treeProvider.getRevision(selected);
        const content = await readFileAtRevision(selected.repoRoot, revision.revision, revision.path);
        await executeTest({
          repoRoot: selected.repoRoot,
          sourcePath: selected.file.path,
          revision: revision.revision,
          content
        });
      });
    }),
    vscode.commands.registerCommand("promptHistory.loadRevisionAndTest", async (node?: FileNode) => {
      await runAndReport(async () => {
        const selected = selectedFileNode(node);
        const revision = treeProvider.getRevision(selected);
        const document = await loadNode(selected);

        if (!document) {
          return;
        }

        await executeTest({
          repoRoot: selected.repoRoot,
          sourcePath: selected.file.path,
          revision: revision.revision,
          content: document.getText()
        });
      });
    }),
    vscode.commands.registerCommand("promptHistory.testCurrentPrompt", async () => {
      await runAndReport(async () => {
        const request = await currentPromptRequest();
        await executeTest(request);
      });
    }),
    vscode.commands.registerCommand("promptHistory.selectTestScript", async (node?: RepoNode | FileNode) => {
      await runAndReport(async () => {
        const repoRoot = await selectRepository(node, treeProvider);

        if (!repoRoot) {
          return;
        }

        const selected = await testScriptStore.select(repoRoot);

        if (selected) {
          treeProvider.setTestScript(repoRoot, selected);
          vscode.window.showInformationMessage(`Test script set to ${selected}`);
        }
      });
    }),
    vscode.commands.registerCommand("promptHistory.clearTestScript", async (node?: RepoNode | FileNode) => {
      await runAndReport(async () => {
        const repoRoot = await selectRepository(node, treeProvider);

        if (!repoRoot) {
          return;
        }

        await testScriptStore.clear(repoRoot);
        treeProvider.setTestScript(repoRoot, undefined);
        vscode.window.showInformationMessage(`Cleared test script for ${path.basename(repoRoot)}`);
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

  /** Install Git state listeners for the repositories known to VS Code Source Control.
   *
   * Reusing the existing Git inventory preserves prompt history behavior in mixed and nested workspaces.
   */
  const installGitWatchers = async (): Promise<void> => {
    gitWatchers = await watchWorkspaceRepositories(() => {
      void runAndReport(() => treeProvider.refresh());
    });
    context.subscriptions.push(...gitWatchers);
  };

  void runAndReport(() => treeProvider.refresh());
  void installGitWatchers();
}

/** Deactivate the extension after VS Code disposes registered resources.
 *
 * Registration through the extension context makes explicit teardown unnecessary.
 */
export function deactivate(): void {
  return;
}

/** Convert the active prompt editor into an exact test request.
 *
 * Reading the document buffer includes unsaved edits while repository and glob checks keep execution in scope.
 */
async function currentPromptRequest(): Promise<PromptTestRequest> {
  const document = vscode.window.activeTextEditor?.document;

  if (!document || document.uri.scheme !== "file") {
    throw new Error("Open a working-tree prompt file before testing the current prompt");
  }

  const roots = await findWorkspaceRepoRoots();
  const repoRoot = roots.find((root) => isPathInsideRepository(document.uri.fsPath, root));

  if (!repoRoot) {
    throw new Error("The active file is not inside a discovered Git repository");
  }

  const sourcePath = toRepositoryRelativePath(repoRoot, document.uri.fsPath);

  if (!isPromptPath(sourcePath, readSettings())) {
    throw new Error(`${sourcePath} is not included by the Prompt History file settings`);
  }

  return { repoRoot, sourcePath, revision: "", content: document.getText() };
}

/** Resolve a command target to one repository, prompting only when the target is ambiguous.
 *
 * Using the history provider first keeps configuration aligned with the repositories visible to the user.
 */
async function selectRepository(
  node: RepoNode | FileNode | undefined,
  treeProvider: PromptHistoryTreeProvider
): Promise<string | undefined> {
  if (node instanceof RepoNode || node instanceof FileNode) {
    return node.repoRoot;
  }

  const roots = treeProvider.getRepositoryRoots().length > 0
    ? treeProvider.getRepositoryRoots()
    : await findWorkspaceRepoRoots();

  if (roots.length === 0) {
    throw new Error("No active Git repository found");
  }

  if (roots.length === 1) {
    return roots[0];
  }

  const selected = await vscode.window.showQuickPick(
    roots.map((repoRoot) => ({ label: path.basename(repoRoot), description: repoRoot, repoRoot })),
    { placeHolder: "Select the repository to configure" }
  );
  return selected?.repoRoot;
}

/** Require workspace trust before executing repository-owned code.
 *
 * Prompt tests are explicit commands but still inherit the security boundary used by VS Code tasks and extensions.
 */
function requireTrustedWorkspace(): void {
  if (!vscode.workspace.isTrusted) {
    throw new Error("Trust this workspace before running a prompt test script");
  }
}

/** Determine whether a file is contained by a repository root.
 *
 * A path-relative check avoids false matches from repositories with similar string prefixes.
 */
function isPathInsideRepository(filePath: string, repoRoot: string): boolean {
  const relative = path.relative(repoRoot, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Append a complete, structured test run to the dedicated output channel.
 *
 * Keeping raw stdout and stderr intact makes validator diagnostics useful without affecting status mapping.
 */
function writeTestOutput(
  output: vscode.OutputChannel,
  request: PromptTestRequest,
  scriptPath: string,
  result: PromptTestResult
): void {
  output.appendLine(`[${new Date().toISOString()}] ${result.status.toUpperCase()} ${request.sourcePath}`);
  output.appendLine(`Repository: ${request.repoRoot}`);
  output.appendLine(`Revision: ${request.revision || "working document"}`);
  output.appendLine(`Script: ${scriptPath}`);
  output.appendLine(`Duration: ${result.durationMs} ms`);

  if (result.stdout) {
    output.appendLine("stdout:");
    output.appendLine(result.stdout);
  }

  if (result.stderr) {
    output.appendLine("stderr:");
    output.appendLine(result.stderr);
  }

  output.appendLine("");
}

/** Show a concise completion message and reveal diagnostics when attention is needed.
 *
 * Successful runs do not steal focus, while failed, cancelled, and errored runs expose their actionable output.
 */
function showTestResult(
  output: vscode.OutputChannel,
  request: PromptTestRequest,
  result: PromptTestResult
): void {
  const message = `${testStatusLabel(result.status)}: ${request.sourcePath} (${result.durationMs} ms)`;

  if (result.status === "passed") {
    vscode.window.showInformationMessage(message);
    return;
  }

  output.show(true);

  if (result.status === "failed") {
    vscode.window.showWarningMessage(message);
  } else {
    vscode.window.showErrorMessage(message);
  }
}

/** Format a public test status for user-facing messages.
 *
 * A single formatter keeps notifications and future status surfaces consistent.
 */
function testStatusLabel(status: PromptTestResult["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Execute an asynchronous command and report its failure consistently.
 *
 * Central handling prevents command callbacks from leaking rejected promises into the extension host.
 */
async function runAndReport(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Prompt History: ${message}`);
  }
}
