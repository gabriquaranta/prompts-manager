import { describe, expect, it } from "vitest";
import { matchesPromptCommit } from "../src/search";
import { PromptCommit } from "../src/types";

const commit: PromptCommit = {
  hash: "abc123",
  shortHash: "abc123",
  author: "Ada Lovelace",
  date: "2026-06-09",
  subject: "Improve banking prompt",
  files: [
    { status: "M", path: "prompts/banking.prompt.md" },
    { status: "A", path: "prompts/new.prompt.md" }
  ]
};

describe("matchesPromptCommit", () => {
  it("matches ordinary text across commit and file metadata", () => {
    expect(matchesPromptCommit(commit, "/workspace/banking", { query: "banking new.prompt" })).toBe(true);
  });

  it("supports author, status, repository, and date filters", () => {
    expect(matchesPromptCommit(commit, "/workspace/banking", { query: "author:ada status:a repo:banking after:2026-01-01" })).toBe(true);
    expect(matchesPromptCommit(commit, "/workspace/banking", { query: "before:2026-01-01" })).toBe(false);
  });

  it("limits matches to the active prompt file", () => {
    expect(matchesPromptCommit(commit, "/workspace/banking", {
      query: "",
      filePath: "prompts/banking.prompt.md",
      repositoryRoot: "/workspace/banking"
    })).toBe(true);
    expect(matchesPromptCommit(commit, "/workspace/banking", {
      query: "",
      filePath: "prompts/missing.prompt.md",
      repositoryRoot: "/workspace/banking"
    })).toBe(false);
  });
});
