import type { GeneratedFile } from "../services/claudeService";
import { chunkProject, searchChunks, searchBySymbol } from "../rag/retrievalEngine";

export type QAResult = {
  answer: string;
  relevantFiles: string[];
  chunks: string[];
  confidence: number;
};

// Answer natural language questions about the codebase
export const askCodebase = async (files: GeneratedFile[], question: string): Promise<QAResult> => {
  // Try symbol-level search first for "where is X", "find Y" queries
  const symbolMatch = question.match(/\b(?:where|find|locate|search|mana|cari)\s+(?:is\s+)?(\w+)/i);
  if (symbolMatch) {
    const symResult = await searchBySymbol(files, symbolMatch[1]);
    if (symResult && !symResult.startsWith("No references")) {
      return { answer: symResult, relevantFiles: [symResult], chunks: [symResult], confidence: 90 };
    }
  }

  const chunks = chunkProject(files);
  const results = searchChunks(chunks, question, 8);

  if (results.length === 0) {
    return { answer: "I couldn't find relevant code for that question.", relevantFiles: [], chunks: [], confidence: 0 };
  }

  const relevantFiles = [...new Set(results.map((r) => r.chunk.filePath))];
  const topChunks = results.slice(0, 5).map((r) => r.chunk.content);

  const answer = buildAnswer(question, results);

  return {
    answer,
    relevantFiles,
    chunks: topChunks,
    confidence: Math.round(results[0].score * 100),
  };
};

const buildAnswer = (question: string, results: ReturnType<typeof searchChunks>): string => {
  const top = results[0];
  if (!top) return "No relevant code found.";

  const q = question.toLowerCase();
  const lines: string[] = [];

  lines.push(`Found ${results.length} relevant code sections across ${new Set(results.map(r => r.chunk.filePath)).size} files.\n`);

  // "where is X defined"
  if (/where|mana|location|defined|definition|find/i.test(q)) {
    lines.push(`**Definition found in \`${top.chunk.filePath}\` (line ${top.chunk.startLine}):**`);
    lines.push("```\n" + top.chunk.content.slice(0, 300) + "\n```");
    return lines.join("\n");
  }

  // "how does X work"
  if (/how|bagaimana|work|function|implement|explain/i.test(q)) {
    lines.push(`**Implementation in \`${top.chunk.filePath}\`:**`);
    lines.push("```\n" + top.chunk.content.slice(0, 500) + "\n```");
    return lines.join("\n");
  }

  // "show all X"
  lines.push("**Matching files:**");
  for (const r of results.slice(0, 5)) {
    lines.push(`- \`${r.chunk.filePath}\` — ${r.chunk.summary}`);
  }
  return lines.join("\n");
};

// Batch analysis — generate a summary of the entire codebase
export const summarizeCodebase = (files: GeneratedFile[]): string => {
  const totalFiles = files.length;
  const totalLines = files.reduce((s, f) => s + (f.content ?? "").split("\n").length, 0);
  const byType: Record<string, number> = {};
  files.forEach((f) => {
    const ext = f.path.split(".").pop() ?? "other";
    byType[ext] = (byType[ext] || 0) + 1;
  });

  return [
    `**Codebase Summary** — ${totalFiles} files, ~${totalLines.toLocaleString()} lines`,
    "",
    "**File types:**",
    ...Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => `  • .${ext}: ${count} files`),
    "",
    `**Top-level structure:**`,
    ...files
      .filter((f) => !f.path.includes("/"))
      .map((f) => `  • ${f.path}`),
  ].join("\n");
};