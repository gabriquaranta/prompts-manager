import { PromptCommit, PromptHistoryFilter } from "./types";

export function matchesPromptCommit(
  commit: PromptCommit,
  repoRoot: string,
  filter: PromptHistoryFilter
): boolean {
  if (filter.filePath && !commit.files.some((file) => {
    return file.path === filter.filePath || file.oldPath === filter.filePath;
  })) {
    return false;
  }

  const tokens = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return tokens.every((token) => matchesToken(token, commit, repoRoot));
}

function matchesToken(token: string, commit: PromptCommit, repoRoot: string): boolean {
  const separator = token.indexOf(":");

  if (separator > 0) {
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);

    if (key === "author") {
      return commit.author.toLowerCase().includes(value);
    }

    if (key === "repo") {
      return repoRoot.toLowerCase().includes(value);
    }

    if (key === "status") {
      return commit.files.some((file) => file.status.toLowerCase() === value);
    }

    if (key === "date" || key === "after") {
      return commit.date >= value;
    }

    if (key === "before") {
      return commit.date <= value;
    }
  }

  const haystack = [
    commit.subject,
    commit.author,
    commit.date,
    repoRoot,
    ...commit.files.flatMap((file) => [file.path, file.oldPath ?? ""])
  ].join(" ").toLowerCase();

  return haystack.includes(token);
}
