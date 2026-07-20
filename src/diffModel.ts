import { PromptCommit, PromptFileChange, PromptRevision, PromptWorkingChange } from "./types";

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

/** Build the HEAD-to-working-content diff boundary for one local prompt change.
 *
 * Explicit empty sides correctly represent added, untracked, and deleted prompts without fake Git revisions.
 */
export function buildWorkingDiffData(
  repoRoot: string,
  change: PromptWorkingChange
): DiffData {
  return {
    left: {
      repoRoot,
      revision: "HEAD",
      path: change.oldPath ?? change.path,
      empty: change.kind === "added" || change.kind === "untracked"
    },
    right: {
      repoRoot,
      revision: "",
      path: change.path,
      empty: change.kind === "deleted" && !change.unsaved,
      workingTree: true
    },
    title: `${change.path}: HEAD ↔ Working Changes`
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
