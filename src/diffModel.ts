import { PromptCommit, PromptFileChange, PromptRevision } from "./types";

export interface DiffDocumentData {
  repoRoot: string;
  revision: string;
  path: string;
  empty: boolean;
  workingTree?: boolean;
}

export interface DiffData {
  left: DiffDocumentData;
  right: DiffDocumentData;
  title: string;
}

export function buildDiffData(repoRoot: string, commit: PromptCommit, file: PromptFileChange): DiffData {
  return {
    left: {
      repoRoot,
      revision: `${commit.hash}^`,
      path: file.oldPath ?? file.path,
      empty: file.status === "A"
    },
    right: {
      repoRoot,
      revision: commit.hash,
      path: file.path,
      empty: file.status === "D"
    },
    title: `${file.path} (${commit.shortHash})`
  };
}

export function buildRevisionDiffData(left: PromptRevision, right: PromptRevision): DiffData {
  return {
    left: toDocumentData(left),
    right: toDocumentData(right),
    title: `${left.label} ↔ ${right.label}`
  };
}

function toDocumentData(revision: PromptRevision): DiffDocumentData {
  return {
    repoRoot: revision.repoRoot,
    revision: revision.revision,
    path: revision.path,
    empty: false,
    workingTree: revision.workingTree
  };
}
