import type { GeneratedFile } from "../services/claudeService";
import { buildCodeGraph, findReferences, type CodeGraph } from "../codeIntel/astParser";
import { indexProject, semanticSearch } from "./embeddingService";

// ── Chunk types ──────────────────────────────────────────────
export type CodeChunk = {
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  type: "function" | "class" | "component" | "import" | "export" | "block" | "file";
  summary: string;
  tokens: number;
};

// ── Search result ────────────────────────────────────────────
export type SearchResult = {
  chunk: CodeChunk;
  score: number; // 0-1 relevance score
  matchType: "exact" | "fuzzy" | "semantic";
};

// ── Chunking strategy ────────────────────────────────────────
export const chunkFile = (file: GeneratedFile): CodeChunk[] => {
  const content = file.content ?? "";
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];
  let currentChunk: string[] = [];
  let chunkStart = 1;
  let currentType: CodeChunk["type"] = "block";

  const flushChunk = (endLine: number) => {
    if (currentChunk.length === 0) return;
    const text = currentChunk.join("\n");
    chunks.push({
      id: `${file.path}-${chunkStart}`,
      filePath: file.path,
      content: text,
      startLine: chunkStart,
      endLine: endLine - 1,
      type: currentType,
      summary: text.slice(0, 100).replace(/\n/g, " "),
      tokens: Math.ceil(text.length / 3.5),
    });
    currentChunk = [];
    chunkStart = endLine;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect chunk type boundaries
    const isFuncStart = /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed);
    const isClassStart = /^(export\s+)?class\s+\w+/.test(trimmed);
    const isComponentStart = /^(export\s+)?(default\s+)?function\s+[A-Z]\w+/.test(trimmed);
    const isImport = /^import\s+/.test(trimmed);
    const isExport = /^export\s+/.test(trimmed);

    if (isComponentStart || isClassStart || isFuncStart) {
      flushChunk(i + 1);
      currentType = isComponentStart ? "component" : isClassStart ? "class" : "function";
    } else if (isImport && currentType !== "import") {
      flushChunk(i + 1);
      currentType = "import";
    } else if (isExport && currentType !== "export") {
      flushChunk(i + 1);
      currentType = "export";
    }

    currentChunk.push(line);

    // Flush if chunk is getting large (>50 lines)
    if (currentChunk.length >= 50) flushChunk(i + 1);
  }

  flushChunk(lines.length);

  // If only one chunk, label it as "file"
  if (chunks.length === 1) chunks[0].type = "file";

  return chunks;
};

// ── Chunk entire project ─────────────────────────────────────
export const chunkProject = (files: GeneratedFile[]): CodeChunk[] => {
  let allChunks: CodeChunk[] = [];
  for (const file of files) {
    allChunks = allChunks.concat(chunkFile(file));
  }
  return allChunks;
};

// ── Keyword-based search (BM25-style, without embeddings) ────
export const searchChunks = (chunks: CodeChunk[], query: string, topK = 10): SearchResult[] => {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const results: SearchResult[] = [];

  for (const chunk of chunks) {
    const content = chunk.content.toLowerCase();
    let score = 0;

    // Exact match bonus
    if (content.includes(query.toLowerCase())) score += 0.4;

    // Term frequency scoring
    for (const term of terms) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = content.match(regex);
      if (matches) score += Math.min(0.3, matches.length * 0.05);
    }

    // File name match
    if (chunk.filePath.toLowerCase().includes(terms[0] || "")) score += 0.2;

    // Component/function name match in first line
    const firstLine = content.split("\n")[0].toLowerCase();
    if (terms.some((t) => firstLine.includes(t))) score += 0.15;

    // Type-based boost
    if (chunk.type === "component") score += 0.05;
    if (chunk.type === "function" && query.includes("function")) score += 0.1;

    if (score > 0) {
      results.push({ chunk, score: Math.min(1, score), matchType: score > 0.5 ? "exact" : "fuzzy" });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
};

// ── Retrieve relevant context for a query ────────────────────
export const retrieveContext = (
  files: GeneratedFile[],
  query: string,
  maxTokens = 4000
): string => {
  // Use semantic search when possible
  const entries = indexProject(files);
  const semResults = semanticSearch(entries, query, 15);

  let context = "";
  let tokens = 0;

  for (const { entry, score } of semResults) {
    const chunk = entry.chunk;
    const chunkText = `// ${chunk.filePath} (${chunk.type}, lines ${chunk.startLine}-${chunk.endLine}) [${(score * 100).toFixed(0)}%]\n${chunk.content}`;
    const ct = Math.ceil(chunkText.length / 3.5);
    if (tokens + ct > maxTokens) break;
    context += chunkText + "\n\n";
    tokens += ct;
  }

  // Fallback to BM25 if semantic returns nothing
  if (!context) {
    const chunks = chunkProject(files);
    const results = searchChunks(chunks, query, 15);
    for (const r of results) {
      const chunkText = `// ${r.chunk.filePath} (${r.chunk.type}, lines ${r.chunk.startLine}-${r.chunk.endLine})\n${r.chunk.content}`;
      const ct = Math.ceil(chunkText.length / 3.5);
      if (tokens + ct > maxTokens) break;
      context += chunkText + "\n\n";
      tokens += ct;
    }
  }

  return context.trim();
};

// ── Hybrid search: keyword + structural signals ──────────────
// ── AST-enhanced search ──────────────────────────────────────
let cachedGraph: CodeGraph | null = null;
let cachedGraphFiles: number = -1;

const getGraph = async (files: GeneratedFile[]): Promise<CodeGraph> => {
  if (cachedGraph && cachedGraphFiles === files.length && cachedGraph.files.length === files.length) return cachedGraph;
  cachedGraph = await buildCodeGraph(files);
  cachedGraphFiles = files.length;
  return cachedGraph;
};

export const searchBySymbol = async (files: GeneratedFile[], query: string): Promise<string> => {
  const graph = await getGraph(files);
  const refs = findReferences(graph, query);
  const parts: string[] = [];

  if (refs.symbols.length > 0) {
    parts.push(`**Symbol: ${query}**`);
    refs.symbols.forEach((s) => parts.push(`  • ${s.kind} defined in \`${s.filePath}\` line ${s.line}`));
  }
  if (refs.calls.length > 0) {
    parts.push(`\n**Called in:**`);
    refs.calls.slice(0, 10).forEach((c) => parts.push(`  • \`${c.filePath}\`:${c.line} from ${c.caller}()`));
  }
  if (refs.imports.length > 0) {
    parts.push(`\n**Imported in:**`);
    refs.imports.forEach((i) => parts.push(`  • \`${i.filePath}\` line ${i.line}`));
  }

  return parts.length > 0 ? parts.join("\n") : `No references found for "${query}".`;
};

export const getProjectGraph = async (files: GeneratedFile[]): Promise<CodeGraph> => getGraph(files);

export const hybridSearch = (
  files: GeneratedFile[],
  query: string,
  topK = 10
): SearchResult[] => {
  const chunks = chunkProject(files);
  const keywordResults = searchChunks(chunks, query, topK * 2);

  // Boost results that are structurally important
  return keywordResults
    .map((r) => {
      let boost = r.score;
      if (r.chunk.type === "component" && /app|page|layout/.test(r.chunk.filePath)) boost *= 1.3;
      if (r.chunk.type === "function" && /export/.test(r.chunk.content)) boost *= 1.2;
      if (r.chunk.type === "import") boost *= 0.7;
      return { ...r, score: Math.min(1, boost) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
};