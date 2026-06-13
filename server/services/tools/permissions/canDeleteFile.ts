// ─────────────────────────────────────────────────────────────
// server/services/tools/permissions/canDeleteFile.ts
// Guard rails for file/directory deletion by agents
// ─────────────────────────────────────────────────────────────
import path from "path";

// Filenames/dirs that must never be deleted, regardless of workspace
const PROTECTED_NAMES = new Set([
  ".git", "node_modules", ".env", ".env.local",
  "package.json", "package-lock.json", "tsconfig.json",
  ".gitignore", "Dockerfile",
]);

export interface DeleteCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Determines whether `targetPath` may be deleted, given the agent's
 * sandboxed workspace root.
 *
 * Rules:
 *  - target must resolve to a path INSIDE workspaceRoot (no path traversal)
 *  - target must not be the workspace root itself
 *  - target's basename must not be a protected name
 */
export function canDeleteFile(targetPath: string, workspaceRoot: string): DeleteCheckResult {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(workspaceRoot, targetPath);

  if (resolvedTarget === resolvedRoot) {
    return { allowed: false, reason: "Cannot delete the workspace root" };
  }

  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { allowed: false, reason: "Path traversal outside workspace is not allowed" };
  }

  const base = path.basename(resolvedTarget);
  if (PROTECTED_NAMES.has(base)) {
    return { allowed: false, reason: `"${base}" is a protected file/directory and cannot be deleted` };
  }

  // Disallow deleting any path containing a protected directory segment
  const segments = relative.split(path.sep);
  for (const segment of segments) {
    if (PROTECTED_NAMES.has(segment)) {
      return { allowed: false, reason: `Path contains protected segment "${segment}"` };
    }
  }

  return { allowed: true };
}