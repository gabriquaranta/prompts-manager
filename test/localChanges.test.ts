import { describe, expect, it } from "vitest";
import { hashPromptContent, mergeUnsavedChanges, parseWorkingChanges } from "../src/localChanges";

describe("parseWorkingChanges", () => {
  it("normalizes staged, working, combined, untracked, deleted, and renamed states", () => {
    const changes = parseWorkingChanges([
      " M prompts/working.prompt.md",
      "M  prompts/staged.prompt.md",
      "MM prompts/both.prompt.md",
      "?? prompts/new.prompt.md",
      " D prompts/deleted.prompt.md",
      "R  prompts/renamed.prompt.md",
      "prompts/old.prompt.md",
      ""
    ].join("\0"));

    expect(changes).toEqual([
      {
        path: "prompts/working.prompt.md",
        kind: "modified",
        staged: false,
        workingTree: true,
        untracked: false,
        unsaved: false
      },
      {
        path: "prompts/staged.prompt.md",
        kind: "modified",
        staged: true,
        workingTree: false,
        untracked: false,
        unsaved: false
      },
      {
        path: "prompts/both.prompt.md",
        kind: "modified",
        staged: true,
        workingTree: true,
        untracked: false,
        unsaved: false
      },
      {
        path: "prompts/new.prompt.md",
        kind: "untracked",
        staged: false,
        workingTree: true,
        untracked: true,
        unsaved: false
      },
      {
        path: "prompts/deleted.prompt.md",
        kind: "deleted",
        staged: false,
        workingTree: true,
        untracked: false,
        unsaved: false
      },
      {
        path: "prompts/renamed.prompt.md",
        oldPath: "prompts/old.prompt.md",
        kind: "renamed",
        staged: true,
        workingTree: false,
        untracked: false,
        unsaved: false
      }
    ]);
  });
});

describe("mergeUnsavedChanges", () => {
  it("marks existing paths and adds one node for editor-only changes", () => {
    const changes = mergeUnsavedChanges(
      [{
        path: "prompts/existing.prompt.md",
        kind: "modified",
        staged: true,
        workingTree: false,
        untracked: false,
        unsaved: false
      }],
      ["prompts/existing.prompt.md", "prompts/editor-only.prompt.md"]
    );

    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({ path: "prompts/existing.prompt.md", staged: true, unsaved: true });
    expect(changes[0]).toMatchObject({ path: "prompts/editor-only.prompt.md", unsaved: true });
  });

  it("hashes exact content rather than timestamps", () => {
    expect(hashPromptContent("same")).toBe(hashPromptContent("same"));
    expect(hashPromptContent("same")).not.toBe(hashPromptContent("different"));
  });
});
