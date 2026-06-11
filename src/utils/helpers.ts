// ─────────────────────────────────────────────────────────────
// helpers.ts — Shared pure utilities
// ─────────────────────────────────────────────────────────────

export const createId = (): string =>
  (crypto as { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export const createTitle = (prompt: string): string => {
  const title = prompt.trim();
  if (!title) return "New Chat";
  return title.length > 34 ? `${title.slice(0, 34)}...` : title;
};

export const STATUS_PREFIXES = [
  "Thinking", "Perfect!", "Starting", "Planning", "Generating",
  "Applying", "Got it!", "I'll build", "Alright", "Analysis",
];