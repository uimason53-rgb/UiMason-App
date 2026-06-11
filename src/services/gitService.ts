import type { GeneratedFile } from "./claudeService";

export type GitDiff = {
  filePath: string;
  status: "added" | "modified" | "deleted" | "unchanged";
  additions: number;
  deletions: number;
  patch: string;
};

// Generate a git-style diff between original and new files
export const generateDiff = (original: GeneratedFile[], modified: GeneratedFile[]): GitDiff[] => {
  const diffs: GitDiff[] = [];
  const origMap = new Map(original.map((f) => [f.path, f]));
  const modMap = new Map(modified.map((f) => [f.path, f]));

  // Added & modified files
  for (const [path, modFile] of modMap) {
    const origFile = origMap.get(path);
    if (!origFile) {
      diffs.push({ filePath: path, status: "added", additions: lineCount(modFile.content), deletions: 0, patch: modFile.content || "" });
    } else if (origFile.content !== modFile.content) {
      const { adds, dels, patch } = computeLineDiff(origFile.content || "", modFile.content || "");
      diffs.push({ filePath: path, status: "modified", additions: adds, deletions: dels, patch });
    } else {
      diffs.push({ filePath: path, status: "unchanged", additions: 0, deletions: 0, patch: "" });
    }
  }

  // Deleted files
  for (const [path, origFile] of origMap) {
    if (!modMap.has(path)) {
      diffs.push({ filePath: path, status: "deleted", additions: 0, deletions: lineCount(origFile.content), patch: "" });
    }
  }

  return diffs;
};

export const generateDiffSummary = (diffs: GitDiff[]): string => {
  const added = diffs.filter((d) => d.status === "added");
  const modified = diffs.filter((d) => d.status === "modified");
  const deleted = diffs.filter((d) => d.status === "deleted");
  const totalAdds = diffs.reduce((s, d) => s + d.additions, 0);
  const totalDels = diffs.reduce((s, d) => s + d.deletions, 0);

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${added.length} new file(s): ${added.map((d) => d.filePath).join(", ")}`);
  if (modified.length > 0) parts.push(`${modified.length} modified: ${modified.map((d) => d.filePath).join(", ")}`);
  if (deleted.length > 0) parts.push(`${deleted.length} deleted: ${deleted.map((d) => d.filePath).join(", ")}`);
  if (parts.length === 0) parts.push("No changes");

  return `${parts.join("\n")}\n+${totalAdds} −${totalDels}`;
};

// Commit message generator
export const generateCommitMessage = (diffs: GitDiff[], userPrompt: string): string => {
  const changes = generateDiffSummary(diffs);
  const shortPrompt = userPrompt.slice(0, 60).replace(/\n/g, " ");
  return `${describeIntent(shortPrompt)}\n\n${changes}`;
};

const describeIntent = (prompt: string): string => {
  const p = prompt.toLowerCase();
  if (p.includes("fix") || p.includes("debug")) return "fix: " + prompt;
  if (p.includes("add") || p.includes("tambah")) return "feat: " + prompt;
  if (p.includes("refactor") || p.includes("improve")) return "refactor: " + prompt;
  if (p.includes("style") || p.includes("css") || p.includes("design")) return "style: " + prompt;
  if (p.includes("test")) return "test: " + prompt;
  return "feat: " + prompt;
};

const lineCount = (content?: string): number => (content || "").split("\n").length;

const computeLineDiff = (a: string, b: string): { adds: number; dels: number; patch: string } => {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const adds = bLines.filter((l) => !aLines.includes(l)).length;
  const dels = aLines.filter((l) => !bLines.includes(l)).length;
  const patchLines: string[] = [];
  for (const l of aLines) { if (!bLines.includes(l)) patchLines.push(`- ${l}`); }
  bLines.forEach((l) => { if (!aLines.includes(l)) patchLines.push(`+ ${l}`); });
  return { adds, dels, patch: patchLines.slice(0, 20).join("\n") };
};