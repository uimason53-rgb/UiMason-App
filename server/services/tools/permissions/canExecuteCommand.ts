// ─────────────────────────────────────────────────────────────
// server/services/tools/permissions/canExecuteCommand.ts
// Guard rails for terminal/shell command execution by agents
// ─────────────────────────────────────────────────────────────

const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/(?!\S)/i,        // rm -rf /
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\{\s*:\|:&\s*\};:/,        // fork bomb
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bchmod\s+-R\s+777\s+\//i,
  /\bcurl\b.*\|\s*sh\b/i,
  /\bwget\b.*\|\s*sh\b/i,
  /\b(sudo|su)\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bnc\b.*-e\b/i,                 // reverse shell via netcat
];

const ALLOWED_BINARIES = new Set([
  "node", "npm", "npx", "pnpm", "yarn",
  "git", "ls", "cat", "echo", "pwd", "cd",
  "mkdir", "touch", "cp", "mv", "rm",
  "tsc", "vite", "next", "jest", "vitest",
  "python", "python3", "pip", "pip3",
  "grep", "find", "sed", "awk", "head", "tail",
  "curl", "wget", "test", "true", "false",
]);

export interface CommandCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Determines whether an agent/tool is allowed to execute a given shell command.
 * Applies a blocklist of dangerous patterns plus an allowlist of base binaries.
 */
export function canExecuteCommand(command: string): CommandCheckResult {
  const trimmed = command.trim();

  if (!trimmed) {
    return { allowed: false, reason: "Empty command" };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Command matches blocked pattern: ${pattern}` };
    }
  }

  // Check each piped/chained segment's base binary against the allowlist
  const segments = trimmed.split(/&&|\|\||;|\|/).map(s => s.trim()).filter(Boolean);

  for (const segment of segments) {
    const base = segment.split(/\s+/)[0]?.replace(/^.*\//, ""); // strip path prefix
    if (base && !ALLOWED_BINARIES.has(base)) {
      return { allowed: false, reason: `Binary "${base}" is not in the allowed list` };
    }
  }

  return { allowed: true };
}