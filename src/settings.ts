import * as vscode from "vscode";
import { PromptHistorySettings } from "./types";

export function readSettings(): PromptHistorySettings {
  const config = vscode.workspace.getConfiguration("promptHistory");

  return {
    includeGlobs: config.get<string[]>("includeGlobs", []),
    excludeGlobs: config.get<string[]>("excludeGlobs", []),
    maxCommits: config.get<number>("maxCommits", 200)
  };
}
