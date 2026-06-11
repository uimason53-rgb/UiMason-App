// ─────────────────────────────────────────────────────────────
// contextEngine.ts
// Smart context window management — prevents token overflow,
// prioritizes relevant context, and enables efficient prompting
// ─────────────────────────────────────────────────────────────

import type { GeneratedFile } from "./claudeService";
import type { ChatMessage } from "../types/chat";
import { estimateTokens, MODEL_LIMITS } from "./tokenCounter";

// ── Types ─────────────────────────────────────────────────────
export type ContextChunk = {
  id: string;
  content: string;
  tokens: number;
  priority: number;
  source: "system" | "user" | "assistant" | "file" | "plan";
  timestamp: number;
  filePath?: string;
};

export type ContextBudget = {
  maxTokens: number;
  usedTokens: number;
  reservedForResponse: number;
  availableTokens: number;
  chunks: ContextChunk[];
};

export type ContextConfig = {
  modelName: string;
  maxContextTokens: number;
  responseReserveRatio: number;
  recencyWeight: number;
  maxMessagesForContext: number;
  maxFilesForContext: number;
};

// ── Default configs per model ─────────────────────────────────
const MODEL_CONFIGS: Record<string, ContextConfig> = {
  "gpt-5.5": {
    modelName: "gpt-5.5",
    maxContextTokens: MODEL_LIMITS["gpt-5.5"] ?? 128000,
    responseReserveRatio: 0.15,
    recencyWeight: 0.7,
    maxMessagesForContext: 30,
    maxFilesForContext: 50,
  },
  "deepseek-v4-pro": {
    modelName: "deepseek-v4-pro",
    maxContextTokens: MODEL_LIMITS["deepseek-v4-pro"] ?? 128000,
    responseReserveRatio: 0.2,
    recencyWeight: 0.6,
    maxMessagesForContext: 25,
    maxFilesForContext: 40,
  },
  default: {
    modelName: "default",
    maxContextTokens: 8000,
    responseReserveRatio: 0.25,
    recencyWeight: 0.6,
    maxMessagesForContext: 20,
    maxFilesForContext: 30,
  },
};

export const getContextConfig = (modelName?: string): ContextConfig => {
  return MODEL_CONFIGS[modelName ?? ""] ?? MODEL_CONFIGS.default;
};

// ── Create a context chunk ────────────────────────────────────
const createChunk = (
  content: string,
  source: ContextChunk["source"],
  priority: number,
  filePath?: string
): ContextChunk => ({
  id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  content,
  tokens: estimateTokens(content),
  priority: Math.min(100, Math.max(0, priority)),
  source,
  timestamp: Date.now(),
  filePath,
});

// ── Score message relevance ──────────────────────────────────
const scoreMessageRelevance = (
  message: ChatMessage,
  index: number,
  totalMessages: number,
  recencyWeight: number
): number => {
  let score = 50;
  if (message.role === "user") score += 15; else score -= 10;
  const recencyFactor = (index / totalMessages) * recencyWeight * 40;
  score += recencyFactor;
  if (message.content.length > 100) score += 10;
  if (message.content.length > 500) score += 10;
  if (message.content.length < 20) score -= 15;
  if (message.content.includes("```")) score += 10;
  if (message.content.includes("<file")) score += 10;
  return Math.min(100, Math.max(0, Math.round(score)));
};

// ── Score file relevance ──────────────────────────────────────
const scoreFileRelevance = (file: GeneratedFile, userPrompt: string): number => {
  let score = 50;
  const prompt = userPrompt.toLowerCase();
  const fileName = file.path.toLowerCase();
  const content = (file.content ?? "").toLowerCase();
  if (prompt.includes(fileName)) score += 30;
  if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) score += 10;
  if (fileName.endsWith(".css") || fileName.endsWith(".scss")) score += 5;
  if (fileName === "package.json") score -= 10;
  const keywords = prompt.split(/\s+/).filter((w) => w.length > 3);
  const matchCount = keywords.filter((kw) => content.includes(kw)).length;
  score += Math.min(20, matchCount * 5);
  if (file.content && file.content.length > 10000) score -= 10;
  if (file.content && file.content.length < 50) score -= 5;
  if (fileName.endsWith(".json") || fileName.endsWith(".lock") || fileName.startsWith(".")) score -= 15;
  return Math.min(100, Math.max(0, Math.round(score)));
};

// ── Build context budget ──────────────────────────────────────
export const buildContextBudget = (
  systemPrompt: string,
  messages: ChatMessage[],
  files?: GeneratedFile[],
  userPrompt?: string,
  modelName?: string
): ContextBudget => {
  const config = getContextConfig(modelName);
  const reserveTokens = Math.floor(config.maxContextTokens * config.responseReserveRatio);
  const availableTokens = config.maxContextTokens - reserveTokens;
  const chunks: ContextChunk[] = [];

  // System prompt (always included)
  if (systemPrompt) chunks.push(createChunk(systemPrompt, "system", 100));

  // Messages
  const maxMessages = config.maxMessagesForContext;
  const recentMessages = messages.slice(-maxMessages);
  recentMessages.forEach((msg, i) => {
    const score = scoreMessageRelevance(msg, i, recentMessages.length, config.recencyWeight);
    chunks.push(createChunk(msg.content, msg.role === "user" ? "user" : "assistant", score));
  });

  // Files (scored by relevance)
  if (files && files.length > 0 && userPrompt) {
    const scoredFiles = files
      .map((f) => ({ file: f, score: scoreFileRelevance(f, userPrompt) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxFilesForContext);
    scoredFiles.forEach(({ file, score }) => {
      chunks.push(createChunk(
        `<file path="${file.path}">\n${file.content ?? ""}\n</file>`,
        "file", score, file.path
      ));
    });
  }

  // Sort by priority descending
  chunks.sort((a, b) => b.priority - a.priority);

  // Trim to budget
  let usedTokens = 0;
  const includedChunks: ContextChunk[] = [];
  for (const chunk of chunks) {
    if (usedTokens + chunk.tokens <= availableTokens) {
      includedChunks.push(chunk);
      usedTokens += chunk.tokens;
    } else if (chunk.source === "system") {
      includedChunks.push(chunk);
      usedTokens += chunk.tokens;
    } else break;
  }

  return { maxTokens: config.maxContextTokens, usedTokens, reservedForResponse: reserveTokens, availableTokens, chunks: includedChunks };
};

// ── Compose final context ─────────────────────────────────────
export const composeContext = (budget: ContextBudget): string => {
  const sorted = [...budget.chunks].sort((a, b) => {
    const order: Record<string, number> = { system: 0, plan: 1, file: 2, user: 3, assistant: 4 };
    return (order[a.source] ?? 5) - (order[b.source] ?? 5) || a.timestamp - b.timestamp;
  });
  return sorted.map((c) => c.content).join("\n\n");
};