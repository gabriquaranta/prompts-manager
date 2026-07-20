import { createHash } from "node:crypto";
import { PromptWorkingChange, WorkingChangeKind } from "./types";

/** Parse NUL-delimited Git porcelain v1 output into one exact entry per changed path.
 *
 * Porcelain status is stable for tooling and preserves staged, working-tree, untracked, and rename state without text heuristics.
 */
export function parseWorkingChanges(output: string): PromptWorkingChange[] {
  const records = output.split("\0");
  const changes: PromptWorkingChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record.length < 4) {
      continue;
    }

    const indexStatus = record[0];
    const workingStatus = record[1];
    const path = record.slice(3);
    const renamed = isRenameStatus(indexStatus) || isRenameStatus(workingStatus);
    const oldPath = renamed ? records[index += 1] : undefined;
    const untracked = indexStatus === "?" && workingStatus === "?";

    changes.push({
      path,
      oldPath,
      kind: workingChangeKind(indexStatus, workingStatus, untracked),
      staged: !untracked && indexStatus !== " ",
      workingTree: untracked || workingStatus !== " ",
      untracked,
      unsaved: false
    });
  }

  return changes;
}

/** Merge dirty editor paths into normalized Git changes without duplicating files.
 *
 * Editor buffers are the current source of truth even when their on-disk file has not changed yet.
 */
export function mergeUnsavedChanges(
  changes: PromptWorkingChange[],
  dirtyPaths: string[]
): PromptWorkingChange[] {
  const byPath = new Map(changes.map((change) => [change.path, { ...change }]));

  for (const path of dirtyPaths) {
    const change = byPath.get(path);

    if (change) {
      change.unsaved = true;
      change.workingTree = true;
    } else {
      byPath.set(path, {
        path,
        kind: "modified",
        staged: false,
        workingTree: true,
        untracked: false,
        unsaved: true
      });
    }
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/** Hash exact prompt text for current-content test identity.
 *
 * Content identity invalidates results immediately without depending on timestamps or save state.
 */
export function hashPromptContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Identify the user-facing change kind from Git index and working-tree status columns.
 *
 * A fixed priority gives renamed, deleted, and added files their correct diff boundaries before ordinary modification.
 */
function workingChangeKind(indexStatus: string, workingStatus: string, untracked: boolean): WorkingChangeKind {
  if (untracked) {
    return "untracked";
  }

  if (isRenameStatus(indexStatus) || isRenameStatus(workingStatus)) {
    return "renamed";
  }

  if (indexStatus === "D" || workingStatus === "D") {
    return "deleted";
  }

  if (indexStatus === "A" || workingStatus === "A") {
    return "added";
  }

  return "modified";
}

/** Check whether a porcelain status column represents a rename or copy.
 *
 * Git emits a second NUL-delimited path for both states, so parsing must consume it exactly once.
 */
function isRenameStatus(status: string): boolean {
  return status === "R" || status === "C";
}
