// ─────────────────────────────────────────────────────────────
// embeddingService.ts
// Semantic embedding generation + vector similarity search
// Uses character n-gram embeddings as a zero-dependency approach
// Production-grade: upgrade to API-based embeddings for best results
// ─────────────────────────────────────────────────────────────

import type { GeneratedFile } from "../services/claudeService";
import { chunkFile, type CodeChunk } from "./retrievalEngine";

export type VectorEntry = {
  id: string;
  chunk: CodeChunk;
  vector: Float64Array;
  magnitude: number;
};

const DIM = 256; // Embedding dimension

// ── Character-level TF-IDF style embedding ───────────────────
// Maps text to fixed-dimension vector using character n-gram hashing
const generateEmbedding = (text: string): Float64Array => {
  const vec = new Float64Array(DIM);
  const lower = text.toLowerCase();

  // Character bigrams
  for (let i = 0; i < lower.length - 1; i++) {
    const hash = ((lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1)) * 7) % DIM;
    vec[hash]++;
  }

  // Word-level features
  const words = lower.split(/\s+/);
  words.forEach((w) => {
    const h = (w.length * 13) % DIM;
    vec[h] += 0.5;
  });

  // Normalize (L2)
  let sum = 0;
  for (let i = 0; i < DIM; i++) sum += vec[i] * vec[i];
  const mag = Math.sqrt(sum);
  if (mag > 0) for (let i = 0; i < DIM; i++) vec[i] /= mag;

  return vec;
};

// ── Cosine similarity ────────────────────────────────────────
const cosineSimilarity = (a: Float64Array, b: Float64Array): number => {
  let dot = 0;
  for (let i = 0; i < DIM; i++) dot += a[i] * b[i];
  return dot; // Already normalized
};

// ── Create vector entries for chunks ─────────────────────────
export const createEmbeddings = (chunks: CodeChunk[]): VectorEntry[] =>
  chunks.map((chunk) => {
    const text = `${chunk.summary}\n${chunk.content}`;
    const vector = generateEmbedding(text);
    return {
      id: chunk.id,
      chunk,
      vector,
      magnitude: Math.sqrt(vector.reduce((s, v) => s + v * v, 0)),
    };
  });

// ── Index a project ──────────────────────────────────────────
export const indexProject = (files: GeneratedFile[]): VectorEntry[] => {
  const chunks: CodeChunk[] = [];
  for (const f of files) chunks.push(...chunkFile(f));
  return createEmbeddings(chunks);
};

// ── Semantic search ──────────────────────────────────────────
export const semanticSearch = (
  entries: VectorEntry[],
  query: string,
  topK = 10,
  minScore = 0.1
): { entry: VectorEntry; score: number }[] => {
  const queryVec = generateEmbedding(query);
  const results: { entry: VectorEntry; score: number }[] = [];

  for (const entry of entries) {
    const score = cosineSimilarity(queryVec, entry.vector);
    if (score >= minScore) results.push({ entry, score });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
};

// ── Hybrid search: BM25 + semantic ───────────────────────────
export type HybridResult = {
  chunk: CodeChunk;
  bm25Score: number;
  semanticScore: number;
  combinedScore: number;
};

export const hybridSemanticSearch = (
  entries: VectorEntry[],
  bm25Results: { chunk: CodeChunk; score: number }[],
  query: string,
  topK = 10
): HybridResult[] => {
  const semantic = semanticSearch(entries, query, 50);
  const semMap = new Map<string, number>();
  semantic.forEach((r) => semMap.set(r.entry.chunk.id, r.score));

  const combined: HybridResult[] = bm25Results.map((bm) => {
    const semScore = semMap.get(bm.chunk.id) || 0;
    return {
      chunk: bm.chunk,
      bm25Score: bm.score,
      semanticScore: semScore,
      combinedScore: bm.score * 0.3 + semScore * 0.7, // Weighted: 70% semantic, 30% keyword
    };
  });

  return combined.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, topK);
};

// ── Semantic context retrieval ───────────────────────────────
export const retrieveSemanticContext = (
  files: GeneratedFile[],
  query: string,
  maxTokens = 4000
): string => {
  const entries = indexProject(files);
  const results = semanticSearch(entries, query, 15);

  let context = "";
  let tokens = 0;

  for (const { entry, score } of results) {
    const chunk = entry.chunk;
    const chunkText = `// ${chunk.filePath} (${chunk.type}, lines ${chunk.startLine}-${chunk.endLine}) [similarity: ${(score * 100).toFixed(0)}%]\n${chunk.content}`;
    const ct = Math.ceil(chunkText.length / 3.5);
    if (tokens + ct > maxTokens) break;
    context += chunkText + "\n\n";
    tokens += ct;
  }

  return context.trim();
};

// ── Find similar code across project ─────────────────────────
export const findSimilarCode = (
  files: GeneratedFile[],
  snippet: string,
  topK = 5
): { chunk: CodeChunk; score: number }[] => {
  const entries = indexProject(files);
  const results = semanticSearch(entries, snippet, topK, 0.05);
  return results.map(r => ({ chunk: r.entry.chunk, score: r.score }));
};
