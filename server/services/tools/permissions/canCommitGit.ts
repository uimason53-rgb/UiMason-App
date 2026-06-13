// ─────────────────────────────────────────────────────────────
// server/services/tools/permissions/canCommitGit.ts
// Guard rails for git commit/push operations by agents
// ─────────────────────────────────────────────────────────────

const PROTECTED_BRANCHES = new Set(["main", "master", "production", "release"]);

// Basic secret-pattern scan so agents can't accidentally commit credentials
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,                       // AWS access key id
  /sk-[a-zA-Z0-9]{20,}/,                    // generic API secret key style
  /(?:password|passwd|secret|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
];

export interface CommitCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface CommitCheckInput {
  branch: string;
  message: string;
  diff?: string;
  /** If true, this commit will also be pushed remotely */
  push?: boolean;
  /** Whether the caller has been granted elevated git permissions */
  allowProtectedBranch?: boolean;
}

export function canCommitGit(input: CommitCheckInput): CommitCheckResult {
  const { branch, message, diff = "", push = false, allowProtectedBranch = false } = input;

  if (!message || !message.trim()) {
    return { allowed: false, reason: "Commit message cannot be empty" };
  }

  if (PROTECTED_BRANCHES.has(branch.toLowerCase()) && !allowProtectedBranch) {
    return { allowed: false, reason: `Direct commits to protected branch "${branch}" are not allowed` };
  }

  if (push && PROTECTED_BRANCHES.has(branch.toLowerCase()) && !allowProtectedBranch) {
    return { allowed: false, reason: `Pushing directly to protected branch "${branch}" is not allowed` };
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(diff)) {
      return { allowed: false, reason: "Diff appears to contain a secret/credential — commit blocked" };
    }
  }

  return { allowed: true };
}