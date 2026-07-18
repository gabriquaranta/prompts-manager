import { PromptCommit, PromptCommitPage, PromptFileChange } from "./types";

const commitPrefix = "\u001e";
const fieldSeparator = "\u001f";

export const gitLogFormat = `${commitPrefix}%H${fieldSeparator}%h${fieldSeparator}%an${fieldSeparator}%ad${fieldSeparator}%s`;

export function parseGitLog(output: string): PromptCommit[] {
  const commits: PromptCommit[] = [];
  const chunks = output.split(commitPrefix).filter((chunk) => chunk.trim().length > 0);

  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/).filter((line) => line.length > 0);
    const [header, ...changeLines] = lines;
    const [hash, shortHash, author, date, subject] = header.split(fieldSeparator);

    commits.push({
      hash,
      shortHash,
      author,
      date,
      subject,
      files: changeLines.map(parseChangeLine)
    });
  }

  return commits;
}

export function paginatePromptCommits(
  commits: PromptCommit[],
  pageSize: number,
  offset: number
): PromptCommitPage {
  return {
    commits: commits.slice(0, pageSize),
    hasMore: commits.length > pageSize,
    nextOffset: offset + pageSize
  };
}

function parseChangeLine(line: string): PromptFileChange {
  const [rawStatus, firstPath, secondPath] = line.split("\t");
  const status = rawStatus.startsWith("R") ? "R" : rawStatus;

  if (status === "R") {
    return {
      status,
      oldPath: firstPath,
      path: secondPath
    };
  }

  if (status !== "A" && status !== "D" && status !== "M") {
    return {
      status: "M",
      path: firstPath
    };
  }

  return {
    status,
    path: firstPath
  };
}
