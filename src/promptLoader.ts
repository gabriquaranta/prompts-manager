import * as path from "node:path";
import * as vscode from "vscode";
import { buildRevisionUri, PromptDiffProvider } from "./diffProvider";
import { resolveRepositoryPath } from "./repositoryPaths";
import { PromptRevision } from "./types";

export class PromptLoader {
  constructor(private readonly diffProvider: PromptDiffProvider) {}

  /** Preview and load historical content into its exact working-tree path.
   *
   * A confirmed WorkspaceEdit keeps restoration reviewable, undoable, unstaged, and unsaved.
   */
  async load(revision: PromptRevision, targetRelativePath: string, content: string): Promise<vscode.TextDocument | undefined> {
    const targetPath = resolveRepositoryPath(revision.repoRoot, targetRelativePath);
    const targetUri = vscode.Uri.file(targetPath);
    const dirtyDocument = vscode.workspace.textDocuments.find((document) => {
      return document.uri.scheme === "file" && document.uri.fsPath === targetPath && document.isDirty;
    });

    if (dirtyDocument) {
      await vscode.window.showTextDocument(dirtyDocument);
      throw new Error(`Save or discard unsaved changes in ${targetRelativePath} before loading a revision`);
    }

    const exists = await fileExists(targetUri);
    const historicalUri = buildRevisionUri(this.diffProvider, revision);
    const currentUri = exists
      ? targetUri
      : this.diffProvider.registerDocument({
        repoRoot: revision.repoRoot,
        revision: "",
        path: targetRelativePath,
        empty: true
      });

    await vscode.commands.executeCommand(
      "vscode.diff",
      currentUri,
      historicalUri,
      `${targetRelativePath}: current ↔ ${revision.label}`
    );

    const detail = exists
      ? `Replace ${targetRelativePath} with ${revision.label}?`
      : `Create ${targetRelativePath} from ${revision.label}?`;
    const confirmation = await vscode.window.showWarningMessage(detail, { modal: true }, "Load Revision");

    if (confirmation !== "Load Revision") {
      return undefined;
    }

    if (!exists) {
      const createEdit = new vscode.WorkspaceEdit();
      createEdit.createFile(targetUri, { ignoreIfExists: false, overwrite: false });

      if (!await vscode.workspace.applyEdit(createEdit)) {
        throw new Error(`Could not create ${targetRelativePath}`);
      }
    }

    const document = await vscode.workspace.openTextDocument(targetUri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(targetUri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content);

    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error(`Could not load revision into ${targetRelativePath}`);
    }

    const loaded = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(loaded);
    return loaded;
  }
}

/** Check whether a workspace file exists without hiding non-missing filesystem errors.
 *
 * Missing targets are valid because loading a deleted revision may intentionally recreate a file.
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      return false;
    }

    throw error;
  }
}
