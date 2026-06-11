import type { GeneratedFile } from "./claudeService";
import { buildDiffs, summarizeDiff, type DiffFile } from "./diffService";

export type PatchStatus = "pending" | "applied" | "rejected";
export type PatchFileStatus = "added" | "modified" | "deleted";

export type PatchHunkLine = {
  type: "context" | "added" | "removed";
  content: string;
  oldLine?: number;
  newLine?: number;
};

export type PatchHunk = {
  id: string;
  filePath: string;
  status: PatchFileStatus;
  oldStart: number;
  oldLines: string[];
  newStart: number;
  newLines: string[];
  lines: PatchHunkLine[];
  additions: number;
  deletions: number;
};

export type PatchFile = {
  path: string;
  status: PatchFileStatus;
  hunks: PatchHunk[];
  additions: number;
  deletions: number;
};

export type PatchConflict = {
  path: string;
  hunkId?: string;
  reason: string;
};

export type PatchProposal = {
  id: string;
  prompt: string;
  status: PatchStatus;
  createdAt: number;
  summary: string;
  originalFiles: GeneratedFile[];
  proposedFiles: GeneratedFile[];
  diffs: DiffFile[];
  filePatches: PatchFile[];
  changedFiles: string[];
  selectableHunks: string[];
  additions: number;
  deletions: number;
};

export type PatchApplyOptions = {
  selectedHunkIds?: string[];
};

export type PatchRollback = {
  id: string;
  summary: string;
  filesBeforeApply: GeneratedFile[];
  filesAfterApply: GeneratedFile[];
};

export type PatchApplyResult = {
  applied: boolean;
  files: GeneratedFile[];
  conflicts: PatchConflict[];
  appliedHunkIds: string[];
  rollback?: PatchRollback;
};

export type PatchHistoryEntry = {
  id: string;
  prompt: string;
  summary: string;
  changedFiles: string[];
  appliedHunkIds: string[];
  appliedAt: number;
};

type DiffToken =
  | { type: "equal"; oldIndex: number; newIndex: number; content: string }
  | { type: "removed"; oldIndex: number; content: string }
  | { type: "added"; newIndex: number; content: string };

const PATCH_HISTORY_KEY = "uimason_patch_history";

const createId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;

const splitLines = (content: string) => content.split("\n");
const joinLines = (lines: string[]) => lines.join("\n");

const lineDiff = (oldLines: string[], newLines: string[]): DiffToken[] => {
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = oldLines[i] === newLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      tokens.push({ type: "equal", oldIndex: i, newIndex: j, content: oldLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      tokens.push({ type: "removed", oldIndex: i, content: oldLines[i] });
      i += 1;
    } else {
      tokens.push({ type: "added", newIndex: j, content: newLines[j] });
      j += 1;
    }
  }

  while (i < oldLines.length) {
    tokens.push({ type: "removed", oldIndex: i, content: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    tokens.push({ type: "added", newIndex: j, content: newLines[j] });
    j += 1;
  }

  return tokens;
};

const buildModifiedHunks = (filePath: string, oldContent: string, newContent: string): PatchHunk[] => {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const tokens = lineDiff(oldLines, newLines);
  const hunks: PatchHunk[] = [];
  let group: DiffToken[] = [];
  let groupIndex = 0;
  let groupOldStart = 0;
  let groupNewStart = 0;
  let oldCursor = 0;
  let newCursor = 0;

  const flush = () => {
    if (group.length === 0) return;
    const removed = group.filter((token): token is Extract<DiffToken, { type: "removed" }> => token.type === "removed");
    const added = group.filter((token): token is Extract<DiffToken, { type: "added" }> => token.type === "added");
    if (removed.length === 0 && added.length === 0) {
      group = [];
      return;
    }

    const oldStart = removed[0]?.oldIndex ?? groupOldStart;
    const newStart = added[0]?.newIndex ?? groupNewStart;
    const oldHunkLines = removed.map((token) => token.content);
    const newHunkLines = added.map((token) => token.content);

    hunks.push({
      id: `${filePath}:h${groupIndex}`,
      filePath,
      status: "modified",
      oldStart,
      oldLines: oldHunkLines,
      newStart,
      newLines: newHunkLines,
      lines: group.map((token) => {
        if (token.type === "equal") {
          return { type: "context", content: token.content, oldLine: token.oldIndex + 1, newLine: token.newIndex + 1 };
        }
        if (token.type === "removed") {
          return { type: "removed", content: token.content, oldLine: token.oldIndex + 1 };
        }
        return { type: "added", content: token.content, newLine: token.newIndex + 1 };
      }),
      additions: added.length,
      deletions: removed.length,
    });

    groupIndex += 1;
    group = [];
  };

  for (const token of tokens) {
    if (token.type === "equal") {
      flush();
      oldCursor = token.oldIndex + 1;
      newCursor = token.newIndex + 1;
    } else {
      if (group.length === 0) {
        groupOldStart = token.type === "removed" ? token.oldIndex : oldCursor;
        groupNewStart = token.type === "added" ? token.newIndex : newCursor;
      }
      group.push(token);
      if (token.type === "removed") oldCursor = token.oldIndex + 1;
      if (token.type === "added") newCursor = token.newIndex + 1;
    }
  }
  flush();

  return hunks;
};

const buildFilePatch = (path: string, status: PatchFileStatus, original = "", proposed = ""): PatchFile => {
  if (status === "added") {
    const lines = splitLines(proposed);
    const hunk: PatchHunk = {
      id: `${path}:add`,
      filePath: path,
      status,
      oldStart: 0,
      oldLines: [],
      newStart: 0,
      newLines: lines,
      lines: lines.map((content, index) => ({ type: "added", content, newLine: index + 1 })),
      additions: lines.length,
      deletions: 0,
    };
    return { path, status, hunks: [hunk], additions: hunk.additions, deletions: 0 };
  }

  if (status === "deleted") {
    const lines = splitLines(original);
    const hunk: PatchHunk = {
      id: `${path}:delete`,
      filePath: path,
      status,
      oldStart: 0,
      oldLines: lines,
      newStart: 0,
      newLines: [],
      lines: lines.map((content, index) => ({ type: "removed", content, oldLine: index + 1 })),
      additions: 0,
      deletions: lines.length,
    };
    return { path, status, hunks: [hunk], additions: 0, deletions: hunk.deletions };
  }

  const hunks = buildModifiedHunks(path, original, proposed);
  return {
    path,
    status,
    hunks,
    additions: hunks.reduce((sum, hunk) => sum + hunk.additions, 0),
    deletions: hunks.reduce((sum, hunk) => sum + hunk.deletions, 0),
  };
};

const buildFilePatches = (originalFiles: GeneratedFile[], proposedFiles: GeneratedFile[]): PatchFile[] => {
  const originalMap = new Map(originalFiles.map((file) => [file.path, file.content ?? ""]));
  const proposedMap = new Map(proposedFiles.map((file) => [file.path, file.content ?? ""]));
  const paths = new Set([...originalMap.keys(), ...proposedMap.keys()]);
  const patches: PatchFile[] = [];

  for (const path of [...paths].sort()) {
    const original = originalMap.get(path);
    const proposed = proposedMap.get(path);
    if (original === undefined && proposed !== undefined) patches.push(buildFilePatch(path, "added", "", proposed));
    else if (original !== undefined && proposed === undefined) patches.push(buildFilePatch(path, "deleted", original, ""));
    else if (original !== proposed) patches.push(buildFilePatch(path, "modified", original ?? "", proposed ?? ""));
  }

  return patches.filter((patch) => patch.hunks.length > 0);
};

const findSequenceIndex = (source: string[], target: string[], preferredStart: number): number => {
  if (target.length === 0) return Math.min(Math.max(preferredStart, 0), source.length);

  const matchesAt = (start: number) => target.every((line, index) => source[start + index] === line);
  if (preferredStart >= 0 && preferredStart + target.length <= source.length && matchesAt(preferredStart)) return preferredStart;

  for (let i = 0; i <= source.length - target.length; i += 1) {
    if (matchesAt(i)) return i;
  }

  return -1;
};

const applyModifiedHunk = (
  content: string,
  hunk: PatchHunk,
  lineOffset: number
): { content: string; conflict?: PatchConflict } => {
  const lines = splitLines(content);
  const adjustedStart = hunk.oldStart + lineOffset;
  const index = hunk.oldLines.length === 0
    ? Math.min(Math.max(adjustedStart, 0), lines.length)
    : findSequenceIndex(lines, hunk.oldLines, adjustedStart);
  if (index < 0) {
    return {
      content,
      conflict: {
        path: hunk.filePath,
        hunkId: hunk.id,
        reason: "Original hunk lines no longer match current file.",
      },
    };
  }

  lines.splice(index, hunk.oldLines.length, ...hunk.newLines);
  return { content: joinLines(lines) };
};

export const createPatchProposal = (
  prompt: string,
  originalFiles: GeneratedFile[],
  proposedFiles: GeneratedFile[]
): PatchProposal => {
  const diffs = buildDiffs(originalFiles, proposedFiles);
  const filePatches = buildFilePatches(originalFiles, proposedFiles);

  return {
    id: createId("patch"),
    prompt,
    status: "pending",
    createdAt: Date.now(),
    summary: summarizeDiff(diffs),
    originalFiles,
    proposedFiles,
    diffs,
    filePatches,
    changedFiles: filePatches.map((patch) => patch.path),
    selectableHunks: filePatches.flatMap((patch) => patch.hunks.map((hunk) => hunk.id)),
    additions: filePatches.reduce((sum, patch) => sum + patch.additions, 0),
    deletions: filePatches.reduce((sum, patch) => sum + patch.deletions, 0),
  };
};

export const detectPatchConflicts = (
  proposal: PatchProposal,
  currentFiles: GeneratedFile[],
  options: PatchApplyOptions = {}
): PatchConflict[] => {
  const selected = new Set(options.selectedHunkIds ?? proposal.selectableHunks);
  const currentMap = new Map(currentFiles.map((file) => [file.path, file.content ?? ""]));
  const conflicts: PatchConflict[] = [];

  for (const filePatch of proposal.filePatches) {
    const selectedHunks = filePatch.hunks.filter((hunk) => selected.has(hunk.id));
    if (selectedHunks.length === 0) continue;

    if (filePatch.status === "added" && currentMap.has(filePatch.path)) {
      conflicts.push({ path: filePatch.path, reason: "File already exists in current session." });
      continue;
    }

    if (filePatch.status !== "added" && !currentMap.has(filePatch.path)) {
      conflicts.push({ path: filePatch.path, reason: "File was deleted after patch was generated." });
      continue;
    }

    if (filePatch.status === "modified") {
      const current = currentMap.get(filePatch.path) ?? "";
      for (const hunk of selectedHunks) {
        if (findSequenceIndex(splitLines(current), hunk.oldLines, hunk.oldStart) < 0) {
          conflicts.push({
            path: filePatch.path,
            hunkId: hunk.id,
            reason: "Original hunk lines no longer match current file.",
          });
        }
      }
    }
  }

  return conflicts;
};

export const applyPatchProposal = (
  proposal: PatchProposal,
  currentFiles: GeneratedFile[],
  options: PatchApplyOptions = {}
): PatchApplyResult => {
  const selected = new Set(options.selectedHunkIds ?? proposal.selectableHunks);
  const conflicts = detectPatchConflicts(proposal, currentFiles, options);
  if (conflicts.length > 0) {
    return { applied: false, files: currentFiles, conflicts, appliedHunkIds: [] };
  }

  const fileMap = new Map(currentFiles.map((file) => [file.path, { ...file }]));
  const appliedHunkIds: string[] = [];

  for (const filePatch of proposal.filePatches) {
    const selectedHunks = filePatch.hunks.filter((hunk) => selected.has(hunk.id));
    if (selectedHunks.length === 0) continue;

    if (filePatch.status === "added") {
      const hunk = selectedHunks[0];
      fileMap.set(filePatch.path, { path: filePatch.path, content: joinLines(hunk.newLines) });
      appliedHunkIds.push(hunk.id);
      continue;
    }

    if (filePatch.status === "deleted") {
      fileMap.delete(filePatch.path);
      appliedHunkIds.push(...selectedHunks.map((hunk) => hunk.id));
      continue;
    }

    let content = fileMap.get(filePatch.path)?.content ?? "";
    let lineOffset = 0;
    for (const hunk of selectedHunks) {
      const result = applyModifiedHunk(content, hunk, lineOffset);
      if (result.conflict) {
        return { applied: false, files: currentFiles, conflicts: [result.conflict], appliedHunkIds: [] };
      }
      content = result.content;
      lineOffset += hunk.newLines.length - hunk.oldLines.length;
      appliedHunkIds.push(hunk.id);
    }
    fileMap.set(filePatch.path, { path: filePatch.path, content });
  }

  const files = [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));
  const rollback: PatchRollback = {
    id: createId("rollback"),
    summary: `Rollback for ${proposal.summary}`,
    filesBeforeApply: currentFiles,
    filesAfterApply: files,
  };

  recordPatchHistory({
    id: proposal.id,
    prompt: proposal.prompt,
    summary: proposal.summary,
    changedFiles: proposal.changedFiles,
    appliedHunkIds,
    appliedAt: Date.now(),
  });

  return {
    applied: true,
    files,
    conflicts: [],
    appliedHunkIds,
    rollback,
  };
};

export const recordPatchHistory = (entry: PatchHistoryEntry) => {
  try {
    const existing = JSON.parse(localStorage.getItem(PATCH_HISTORY_KEY) || "[]") as PatchHistoryEntry[];
    localStorage.setItem(PATCH_HISTORY_KEY, JSON.stringify([entry, ...existing].slice(0, 50)));
  } catch {
    // History is non-critical; patch apply must not fail because storage is full.
  }
};

export const getPatchHistory = (): PatchHistoryEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(PATCH_HISTORY_KEY) || "[]") as PatchHistoryEntry[];
  } catch {
    return [];
  }
};
