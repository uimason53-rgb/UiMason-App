// ─────────────────────────────────────────────────────────────
// server/services/tools/pathGuard.ts
// Resolves a user/agent-supplied relative path against the
// workspace root and throws if it escapes the sandbox.
// ─────────────────────────────────────────────────────────────
import path from "path";

export class PathTraversalError extends Error {
  constructor(target: string) {
    super(`Path "${target}" resolves outside the workspace and is not allowed`);
    this.name = "PathTraversalError";
  }
}

export function resolveInWorkspace(workspaceRoot: string, target: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathTraversalError(target);
  }

  return resolved;
}