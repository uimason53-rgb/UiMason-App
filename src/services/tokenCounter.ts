// ─────────────────────────────────────────────────────────────
// tokenCounter.ts
// Lightweight token estimation — warns before hitting model limits
// Uses character-based heuristic: ~4 chars ≈ 1 token (conservative)
// ─────────────────────────────────────────────────────────────

import type { GeneratedFile } from "./claudeService";

// ── Constants ─────────────────────────────────────────────────
const CHARS_PER_TOKEN = 3.5; // Conservative estimate (actual is ~4)

// Known model token limits
export const MODEL_LIMITS: Record<string, number> = {
  "claude-sonnet-4-20250514": 200000,
  "deepseek-v4-pro": 128000,
  "gpt-4o-mini": 128000,
  "gpt-5.5": 128000,
  default: 8000, // Safe fallback when model unknown
};

// ── Warning thresholds ────────────────────────────────────────
const WARN_PERCENT = 0.7; // Warn at 70% of limit
const DANGER_PERCENT = 0.9; // Critical at 90%

export type TokenWarning = {
  level: "ok" | "warn" | "danger";
  estimatedTokens: number;
  maxTokens: number;
  usagePercent: number;
  message: string;
};

// ── Estimate tokens from text ─────────────────────────────────
export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
};

// ── Estimate tokens from GeneratedFile[] ──────────────────────
export const estimateFileTokens = (files: GeneratedFile[]): number => {
  return files.reduce((sum, f) => {
    const pathTokens = estimateTokens(f.path);
    const contentTokens = estimateTokens(f.content ?? "");
    // XML wrapper overhead: ~20 chars per file for <file path="..."> tags
    return sum + pathTokens + contentTokens + estimateTokens("file path=\"\"" + f.path);
  }, 0);
};

// ── Estimate tokens from messages ─────────────────────────────
export const estimateMessageTokens = (
  messages: Array<{ role: string; content: string }>
): number => {
  return messages.reduce((sum, m) => {
    const roleTokens = estimateTokens(m.role);
    const contentTokens = estimateTokens(m.content);
    return sum + roleTokens + contentTokens;
  }, 0);
};

// ── Compute total context size ────────────────────────────────
export const estimateContextSize = (params: {
  systemPrompt?: string;
  messages: Array<{ role: string; content: string }>;
  files?: GeneratedFile[];
}): number => {
  let total = 0;
  if (params.systemPrompt) total += estimateTokens(params.systemPrompt);
  total += estimateMessageTokens(params.messages);
  if (params.files) total += estimateFileTokens(params.files);
  // Add 10% overhead for prompt formatting / JSON structure
  return Math.ceil(total * 1.1);
};

// ── Check against model limits ────────────────────────────────
export const checkTokenLimit = (
  estimatedTokens: number,
  modelName?: string
): TokenWarning => {
  const maxTokens = MODEL_LIMITS[modelName ?? ""] ?? MODEL_LIMITS.default;
  const usagePercent = (estimatedTokens / maxTokens) * 100;

  if (usagePercent >= DANGER_PERCENT * 100) {
    return {
      level: "danger",
      estimatedTokens,
      maxTokens,
      usagePercent,
      message: `⚠ Token limit critical: ~${estimatedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} (${usagePercent.toFixed(0)}%). The response may be truncated or fail. Consider starting a new chat or simplifying your request.`,
    };
  }

  if (usagePercent >= WARN_PERCENT * 100) {
    return {
      level: "warn",
      estimatedTokens,
      maxTokens,
      usagePercent,
      message: `⚡ Approaching token limit: ~${estimatedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} (${usagePercent.toFixed(0)}%). Consider simplifying your request for best results.`,
    };
  }

  return {
    level: "ok",
    estimatedTokens,
    maxTokens,
    usagePercent,
    message: "",
  };
};

// ── Convenience: check before sending ─────────────────────────
export const validateContextSize = (params: {
  systemPrompt?: string;
  messages: Array<{ role: string; content: string }>;
  files?: GeneratedFile[];
  modelName?: string;
}): TokenWarning => {
  const estimatedTokens = estimateContextSize(params);
  return checkTokenLimit(estimatedTokens, params.modelName);
};