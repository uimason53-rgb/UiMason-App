import type { GeneratedFile } from "../services/claudeService";
import { buildCodeGraph, type CodeGraph } from "../codeIntel/astParser";
import { chunkProject, hybridSearch, retrieveContext, type CodeChunk } from "../rag/retrievalEngine";
import { indexProject, semanticSearch, type VectorEntry } from "../rag/embeddingService";
import { getRelevantPatterns, getRecentEpisodes, getAllPreferences } from "./memoryManager";

export type ProjectMemoryFile = {
  path: string;
  bytes: number;
  lines: number;
  tokens: number;
  hash: string;
  language: string;
};

export type ProjectMemoryIndex = {
  id: string;
  fingerprint: string;
  framework: string;
  files: ProjectMemoryFile[];
  chunks: CodeChunk[];
  vectors: VectorEntry[];
  graph: CodeGraph | null;
  graphSummary: {
    symbols: number;
    imports: number;
    exports: number;
    calls: number;
    components: string[];
    entryFiles: string[];
  };
  createdAt: number;
  updatedAt: number;
};

export type ProjectContextPack = {
  fingerprint: string;
  framework: string;
  files: ProjectMemoryFile[];
  relevantChunks: Array<{ chunk: CodeChunk; score: number; source: "semantic" | "hybrid" }>;
  graphSummary: ProjectMemoryIndex["graphSummary"];
  memoryText: string;
  contextText: string;
};

const PROJECT_INDEX_KEY = "uimason_project_memory_indexes";
const MAX_INDEXES = 12;
const MAX_STORED_CHUNKS = 900;

const languageFromPath = (filePath: string) => filePath.split(".").pop()?.toLowerCase() || "txt";

const detectProjectFramework = (files: GeneratedFile[]): string => {
  const paths = files.map((file) => file.path.toLowerCase());
  const contents = files.map((file) => (file.content ?? "").toLowerCase());
  const allContent = contents.join(" ");

  if (paths.some((path) => path.startsWith("next.config") || /app\/.*page\.tsx/.test(path))) return "Next.js";
  if (paths.some((path) => path.endsWith(".svelte"))) return "Svelte";
  if (paths.some((path) => path.endsWith(".vue"))) return "Vue.js";
  if (paths.some((path) => path.endsWith(".tsx") || path.endsWith(".jsx")) || allContent.includes("from \"react\"") || allContent.includes("from 'react'")) {
    if (paths.some((path) => path.includes("tailwind")) || allContent.includes("@tailwind")) return "React+Tailwind";
    return "React";
  }
  if (paths.some((path) => path.endsWith(".py"))) return "Python";
  if (paths.some((path) => path.endsWith(".go"))) return "Go";

  return "Unknown";
};

const hashString = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export const fingerprintFiles = (files: GeneratedFile[]) =>
  hashString(
    files
      .map((file) => `${file.path}:${hashString(file.content ?? "")}:${file.content?.length ?? 0}`)
      .sort()
      .join("|")
  );

const loadIndexes = (): ProjectMemoryIndex[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_INDEX_KEY) || "[]") as ProjectMemoryIndex[];
    return parsed.map((index) => ({
      ...index,
      vectors: index.vectors.map((entry) => ({
        ...entry,
        vector: entry.vector instanceof Float64Array
          ? entry.vector
          : Float64Array.from(Object.values(entry.vector as unknown as Record<string, number>).map(Number)),
      })),
    }));
  } catch {
    return [];
  }
};

const saveIndexes = (indexes: ProjectMemoryIndex[]) => {
  try {
    localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(indexes.slice(0, MAX_INDEXES)));
  } catch (error) {
    console.warn("Project memory index save failed", error);
  }
};

const summarizeGraph = (graph: CodeGraph | null, files: GeneratedFile[]): ProjectMemoryIndex["graphSummary"] => {
  const paths = files.map((file) => file.path);
  return {
    symbols: graph?.symbols.length ?? 0,
    imports: graph?.imports.length ?? 0,
    exports: graph?.exports.length ?? 0,
    calls: graph?.calls.length ?? 0,
    components: graph?.symbols
      .filter((symbol) => symbol.kind === "component")
      .map((symbol) => symbol.name)
      .slice(0, 20) ?? [],
    entryFiles: paths.filter((filePath) =>
      /(^src\/main\.(tsx|jsx|ts|js)$)|(^src\/App\.(tsx|jsx|ts|js)$)|(^app\/.*page\.tsx$)|(^pages\/.*\.(tsx|jsx)$)|(^index\.html$)/i.test(filePath)
    ),
  };
};

export const indexProjectMemory = async (files: GeneratedFile[]): Promise<ProjectMemoryIndex> => {
  const fingerprint = fingerprintFiles(files);
  const existing = loadIndexes().find((index) => index.fingerprint === fingerprint);
  if (existing) return existing;

  let graph: CodeGraph | null = null;
  try {
    graph = await buildCodeGraph(files);
  } catch (error) {
    console.warn("Project graph build failed", error);
  }

  const chunks = chunkProject(files).slice(0, MAX_STORED_CHUNKS);
  const vectors = indexProject(files).slice(0, MAX_STORED_CHUNKS);
  const now = Date.now();
  const index: ProjectMemoryIndex = {
    id: `pm-${fingerprint}`,
    fingerprint,
    framework: detectProjectFramework(files),
    files: files.map((file) => {
      const content = file.content ?? "";
      return {
        path: file.path,
        bytes: content.length,
        lines: content.split("\n").length,
        tokens: Math.ceil(content.length / 3.5),
        hash: hashString(content),
        language: languageFromPath(file.path),
      };
    }),
    chunks,
    vectors,
    graph,
    graphSummary: summarizeGraph(graph, files),
    createdAt: now,
    updatedAt: now,
  };

  saveIndexes([index, ...loadIndexes().filter((item) => item.fingerprint !== fingerprint)]);
  return index;
};

const formatMemoryText = (query: string) => {
  const episodes = getRecentEpisodes(4);
  const patterns = getRelevantPatterns(query);
  const prefs = getAllPreferences();
  const parts: string[] = [];

  if (episodes.length > 0) {
    parts.push(`[RECENT PROJECT EPISODES]\n${episodes.map((episode) => `- ${episode.sessionTitle}: ${episode.summary}`).join("\n")}`);
  }

  if (patterns.length > 0) {
    parts.push(`[LEARNED PATTERNS]\n${patterns.map((pattern) => `- ${pattern.pattern}: ${pattern.context} (${pattern.frequency} uses)`).join("\n")}`);
  }

  if (Object.keys(prefs).length > 0) {
    parts.push(`[USER PREFERENCES]\n${Object.entries(prefs).map(([key, value]) => `- ${key}: ${value}`).join("\n")}`);
  }

  return parts.join("\n\n");
};

const formatManifest = (index: ProjectMemoryIndex) =>
  index.files
    .slice()
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 50)
    .map((file) => `- ${file.path} (${file.language}, ${file.lines} lines, ~${file.tokens} tokens)`)
    .join("\n");

const formatContextText = (index: ProjectMemoryIndex, relevantChunks: ProjectContextPack["relevantChunks"], memoryText: string) => {
  const graph = index.graphSummary;
  const chunkText = relevantChunks
    .map(({ chunk, score, source }) =>
      `// ${chunk.filePath}:${chunk.startLine}-${chunk.endLine} (${chunk.type}, ${source}, ${(score * 100).toFixed(0)}%)\n${chunk.content}`
    )
    .join("\n\n");

  return [
    `[PROJECT MEMORY INDEX]`,
    `Fingerprint: ${index.fingerprint}`,
    `Framework: ${index.framework}`,
    `Files: ${index.files.length}`,
    `Estimated tokens: ${index.files.reduce((sum, file) => sum + file.tokens, 0)}`,
    `Symbols: ${graph.symbols}, Imports: ${graph.imports}, Exports: ${graph.exports}, Calls: ${graph.calls}`,
    graph.entryFiles.length ? `Entry files: ${graph.entryFiles.join(", ")}` : "",
    graph.components.length ? `Components: ${graph.components.join(", ")}` : "",
    "",
    `[FILE MANIFEST]`,
    formatManifest(index),
    memoryText ? `\n${memoryText}` : "",
    chunkText ? `\n[RELEVANT CODE CONTEXT]\n${chunkText}` : "",
  ].filter(Boolean).join("\n");
};

export const buildProjectContextPack = async (
  files: GeneratedFile[],
  query: string,
  maxTokens = 5000
): Promise<ProjectContextPack> => {
  const index = await indexProjectMemory(files);
  const semantic = semanticSearch(index.vectors, query, 12, 0.08).map((item) => ({
    chunk: item.entry.chunk,
    score: item.score,
    source: "semantic" as const,
  }));
  const hybrid = hybridSearch(files, query, 12).map((item) => ({
    chunk: item.chunk,
    score: item.score,
    source: "hybrid" as const,
  }));

  const seen = new Set<string>();
  const relevantChunks = [...semantic, ...hybrid]
    .filter((item) => {
      const key = `${item.chunk.filePath}:${item.chunk.startLine}:${item.chunk.endLine}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 18);

  const memoryText = formatMemoryText(query);
  let contextText = formatContextText(index, relevantChunks, memoryText);

  if (Math.ceil(contextText.length / 3.5) > maxTokens) {
    contextText = retrieveContext(files, query, maxTokens);
    contextText = `[PROJECT MEMORY INDEX]\nFramework: ${index.framework}\nFiles: ${index.files.length}\n\n${memoryText}\n\n[RELEVANT CODE CONTEXT]\n${contextText}`.trim();
  }

  return {
    fingerprint: index.fingerprint,
    framework: index.framework,
    files: index.files,
    relevantChunks,
    graphSummary: index.graphSummary,
    memoryText,
    contextText,
  };
};

export const clearProjectMemoryIndexes = () => {
  try {
    localStorage.removeItem(PROJECT_INDEX_KEY);
  } catch {
    // ignore
  }
};
