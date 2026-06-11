import type { GeneratedFile } from "./claudeService";

export type DiffLine = {
  type: "added" | "removed" | "unchanged";
  lineNum: number;
  content: string;
  newLineNum?: number;
};

export type DiffFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "unchanged";
  lines: DiffLine[];
  additions: number;
  deletions: number;
};

const computeDiff = (original: string, modified: string): DiffLine[] => {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const result: DiffLine[] = [];
  const maxLen = Math.max(origLines.length, modLines.length);
  let oi = 0, mi = 0;
  while (oi < maxLen || mi < maxLen) {
    const ol = oi < origLines.length ? origLines[oi] : undefined;
    const ml = mi < modLines.length ? modLines[mi] : undefined;
    if (ol === ml) {
      if (ol !== undefined) result.push({ type: "unchanged", lineNum: oi + 1, content: ol, newLineNum: mi + 1 });
      oi++; mi++;
    } else if (ol !== undefined && !modLines.includes(ol)) {
      result.push({ type: "removed", lineNum: oi + 1, content: ol }); oi++;
    } else if (ml !== undefined && !origLines.includes(ml)) {
      result.push({ type: "added", lineNum: oi, content: ml, newLineNum: mi + 1 }); mi++;
    } else { oi++; mi++; }
  }
  return result;
};

export const buildDiff = (originalContent: string, modifiedContent: string, filePath: string, status: DiffFile["status"]): DiffFile => {
  const lines = computeDiff(originalContent, modifiedContent);
  return { path: filePath, status, lines, additions: lines.filter(l => l.type === "added").length, deletions: lines.filter(l => l.type === "removed").length };
};

export const buildDiffs = (original: GeneratedFile[], modified: GeneratedFile[]): DiffFile[] => {
  const origMap = new Map(original.map(f => [f.path, f]));
  const modMap = new Map(modified.map(f => [f.path, f]));
  const diffs: DiffFile[] = [];
  for (const [path, mod] of modMap) {
    const orig = origMap.get(path);
    if (!orig) diffs.push({ path, status: "added", lines: (mod.content||"").split("\n").map((l,i) => ({ type: "added" as const, lineNum:0, content:l, newLineNum:i+1 })), additions: (mod.content||"").split("\n").length, deletions: 0 });
    else if (orig.content !== mod.content) diffs.push(buildDiff(orig.content||"", mod.content||"", path, "modified"));
    else diffs.push({ path, status: "unchanged", lines: [], additions: 0, deletions: 0 });
  }
  for (const [path, orig] of origMap) {
    if (!modMap.has(path)) diffs.push({ path, status: "deleted", lines: (orig.content||"").split("\n").map((l,i) => ({ type: "removed" as const, lineNum:i+1, content:l })), additions:0, deletions: (orig.content||"").split("\n").length });
  }
  return diffs;
};

export const summarizeDiff = (diffs: DiffFile[]): string => {
  const changed = diffs.filter(d => d.status !== "unchanged");
  const adds = diffs.reduce((s,d) => s + d.additions, 0);
  const dels = diffs.reduce((s,d) => s + d.deletions, 0);
  if (changed.length === 0) return "No changes.";
  return `${changed.length} file(s) changed: +${adds} −${dels}`;
};