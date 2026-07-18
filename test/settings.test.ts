import { describe, expect, it } from "vitest";
import { isPromptPath } from "../src/globs";
import { PromptHistorySettings } from "../src/types";

const settings: PromptHistorySettings = {
  includeGlobs: ["prompts/**", "**/*.prompt.md", "**/*.prompt.txt"],
  excludeGlobs: ["**/node_modules/**", "**/.git/**"],
  maxCommits: 200
};

describe("isPromptPath", () => {
  it("matches configured prompt folders", () => {
    expect(isPromptPath("prompts/example.md", settings)).toBe(true);
  });

  it("matches configured prompt extensions", () => {
    expect(isPromptPath("docs/review.prompt.md", settings)).toBe(true);
  });

  it("excludes configured paths", () => {
    expect(isPromptPath("node_modules/pkg/test.prompt.md", settings)).toBe(false);
  });

  it("ignores unrelated files", () => {
    expect(isPromptPath("src/extension.ts", settings)).toBe(false);
  });
});
