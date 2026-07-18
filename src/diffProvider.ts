import * as path from "node:path";
import * as vscode from "vscode";
import { buildDiffData, buildRevisionDiffData, DiffDocumentData } from "./diffModel";
import { readFileAtRevision } from "./git";
import { PromptCommit, PromptFileChange, PromptRevision } from "./types";

export const diffScheme = "prompt-history-git";

export class PromptDiffProvider implements vscode.TextDocumentContentProvider {
  registerDocument(data: DiffDocumentData): vscode.Uri {
    const query = JSON.stringify(data);
    const basename = path.basename(data.path);

    return vscode.Uri.from({
      scheme: diffScheme,
      path: `/${basename}`,
      query
    });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const data = parseDiffUri(uri);

    if (data.empty) {
      return "";
    }

    if (data.workingTree) {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(data.repoRoot, data.path)));
      return Buffer.from(bytes).toString("utf8");
    }

    return readFileAtRevision(data.repoRoot, data.revision, data.path);
  }
}

export function buildRevisionDiffUris(
  provider: PromptDiffProvider,
  leftRevision: PromptRevision,
  rightRevision: PromptRevision
): { left: vscode.Uri; right: vscode.Uri; title: string } {
  const data = buildRevisionDiffData(leftRevision, rightRevision);
  const left = provider.registerDocument(data.left);
  const right = provider.registerDocument(data.right);

  return { left, right, title: data.title };
}

export function buildRevisionUri(provider: PromptDiffProvider, revision: PromptRevision): vscode.Uri {
  return provider.registerDocument({
    repoRoot: revision.repoRoot,
    revision: revision.revision,
    path: revision.path,
    empty: false,
    workingTree: revision.workingTree
  });
}

export function buildDiffUris(
  provider: PromptDiffProvider,
  repoRoot: string,
  commit: PromptCommit,
  file: PromptFileChange
): { left: vscode.Uri; right: vscode.Uri; title: string } {
  const data = buildDiffData(repoRoot, commit, file);
  const left = provider.registerDocument(data.left);
  const right = provider.registerDocument(data.right);

  return { left, right, title: data.title };
}

export function parseDiffUri(uri: vscode.Uri): DiffDocumentData {
  return JSON.parse(uri.query) as DiffDocumentData;
}
