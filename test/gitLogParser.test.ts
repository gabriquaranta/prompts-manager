import { describe, expect, it } from "vitest";
import { gitLogFormat, paginatePromptCommits, parseGitLog } from "../src/gitLogParser";

describe("parseGitLog", () => {
  it("parses commits and changed files", () => {
    const output = [
      "\u001eabc123\u001fabc123\u001fAda\u001f2026-06-09\u001fEdit prompt",
      "M\tprompts/a.prompt.md",
      "A\tprompts/b.prompt.txt",
      "\u001edef456\u001fdef456\u001fBob\u001f2026-06-08\u001fRename prompt",
      "R100\tprompts/old.prompt.md\tprompts/new.prompt.md",
      ""
    ].join("\n");

    expect(gitLogFormat).toContain("%H");
    expect(parseGitLog(output)).toEqual([
      {
        hash: "abc123",
        shortHash: "abc123",
        author: "Ada",
        date: "2026-06-09",
        subject: "Edit prompt",
        files: [
          { status: "M", path: "prompts/a.prompt.md" },
          { status: "A", path: "prompts/b.prompt.txt" }
        ]
      },
      {
        hash: "def456",
        shortHash: "def456",
        author: "Bob",
        date: "2026-06-08",
        subject: "Rename prompt",
        files: [
          { status: "R", oldPath: "prompts/old.prompt.md", path: "prompts/new.prompt.md" }
        ]
      }
    ]);
  });

  it("tracks the next offset when more commits are available", () => {
    const commits = parseGitLog([
      "\u001eabc123\u001fabc123\u001fAda\u001f2026-06-09\u001fFirst",
      "M\tprompts/a.prompt.md",
      "\u001edef456\u001fdef456\u001fBob\u001f2026-06-08\u001fSecond",
      "M\tprompts/b.prompt.md"
    ].join("\n"));

    expect(paginatePromptCommits(commits, 1, 4)).toEqual({
      commits: [commits[0]],
      hasMore: true,
      nextOffset: 5
    });
  });
});
