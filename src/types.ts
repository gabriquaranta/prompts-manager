export type ChangeStatus = "A" | "D" | "M" | "R";

export interface PromptHistorySettings {
  includeGlobs: string[];
  excludeGlobs: string[];
  maxCommits: number;
  testTimeoutSeconds: number;
}

export type PromptTestStatus = "passed" | "failed" | "error" | "cancelled";

export interface PromptTestRequest {
  repoRoot: string;
  sourcePath: string;
  revision: string;
  content: string;
}

export interface PromptTestResult {
  status: PromptTestStatus;
  exitCode?: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface PromptFileChange {
  status: ChangeStatus;
  path: string;
  oldPath?: string;
}

export interface PromptCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  files: PromptFileChange[];
}

export interface PromptCommitPage {
  commits: PromptCommit[];
  hasMore: boolean;
  nextOffset: number;
}

export interface PromptHistoryFilter {
  query: string;
  filePath?: string;
  repositoryRoot?: string;
}

export interface PromptRevision {
  repoRoot: string;
  revision: string;
  path: string;
  label: string;
  workingTree?: boolean;
}
