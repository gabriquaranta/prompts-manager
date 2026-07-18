import { describe, expect, it } from "vitest";
import { buildDiffData, buildRevisionDiffData } from "../src/diffModel";
import { PromptCommit } from "../src/types";

const commit: PromptCommit = {
  hash: "abc123",
  shortHash: "abc123",
  author: "Ada",
  date: "2026-06-09",
  subject: "Edit prompt",
  files: []
};

describe("buildDiffData", () => {
  it("builds modified file diff data", () => {
    const diff = buildDiffData("/repo", commit, { status: "M", path: "prompts/a.prompt.md" });

    expect(diff.left).toEqual({
      repoRoot: "/repo",
      revision: "abc123^",
      path: "prompts/a.prompt.md",
      empty: false
    });
    expect(diff.right).toEqual({
      repoRoot: "/repo",
      revision: "abc123",
      path: "prompts/a.prompt.md",
      empty: false
    });
  });

  it("uses empty left content for added files", () => {
    const diff = buildDiffData("/repo", commit, { status: "A", path: "prompts/a.prompt.md" });

    expect(diff.left.empty).toBe(true);
    expect(diff.right.empty).toBe(false);
  });

  it("uses empty right content for deleted files", () => {
    const diff = buildDiffData("/repo", commit, { status: "D", path: "prompts/a.prompt.md" });

    expect(diff.left.empty).toBe(false);
    expect(diff.right.empty).toBe(true);
  });

  it("uses old and new paths for renamed files", () => {
    const diff = buildDiffData("/repo", commit, {
      status: "R",
      oldPath: "prompts/old.prompt.md",
      path: "prompts/new.prompt.md"
    });

    expect(diff.left.path).toBe("prompts/old.prompt.md");
    expect(diff.right.path).toBe("prompts/new.prompt.md");
  });

  it("builds a diff between two historical revisions", () => {
    const diff = buildRevisionDiffData(
      {
        repoRoot: "/repo",
        revision: "older",
        path: "prompts/a.prompt.md",
        label: "older revision"
      },
      {
        repoRoot: "/repo",
        revision: "newer",
        path: "prompts/a.prompt.md",
        label: "newer revision"
      }
    );

    expect(diff.left.revision).toBe("older");
    expect(diff.right.revision).toBe("newer");
    expect(diff.title).toBe("older revision ↔ newer revision");
  });

  it("marks a working-tree revision for the content provider", () => {
    const diff = buildRevisionDiffData(
      {
        repoRoot: "/repo",
        revision: "abc123",
        path: "prompts/a.prompt.md",
        label: "committed"
      },
      {
        repoRoot: "/repo",
        revision: "",
        path: "prompts/a.prompt.md",
        label: "working tree",
        workingTree: true
      }
    );

    expect(diff.right.workingTree).toBe(true);
  });
});
