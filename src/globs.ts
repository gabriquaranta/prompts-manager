import { minimatch } from "minimatch";
import { PromptHistorySettings } from "./types";

export function isPromptPath(path: string, settings: PromptHistorySettings): boolean {
  const normalized = path.replaceAll("\\", "/");
  const excluded = settings.excludeGlobs.some((glob) => minimatch(normalized, glob, { dot: true }));

  if (excluded) {
    return false;
  }

  return settings.includeGlobs.some((glob) => minimatch(normalized, glob, { dot: true }));
}
