// ─────────────────────────────────────────────────────────────
// server/services/tools/filesystemTool.ts
// Sandboxed filesystem access for agents — all paths are resolved
// relative to ToolContext.workspaceRoot and cannot escape it.
// ─────────────────────────────────────────────────────────────
import type { Tool, ToolContext, ToolResponse } from "../types/tool.types";
import { filesystemSchema } from "../schemas/toolSchemas";
import { resolveInWorkspace, PathTraversalError } from "./pathGuard";
import { canDeleteFile } from "./permissions/canDeleteFile";

import { readFile } from "../filesystem/readFile";
import { writeFile } from "../filesystem/writeFile";
import { createFile } from "../filesystem/createFile";
import { listFiles } from "../filesystem/listFiles";
import { mkdir } from "../filesystem/mkdir";
import { moveFile } from "../filesystem/moveFile";
import { deleteFile } from "../filesystem/deleteFile";
import { statFile } from "../filesystem/statFile";

export const filesystemTool: Tool = {
  name: "filesystem",

  description:
    "Read, write, create, move, delete, list and stat files inside the current workspace. " +
    "Actions: read, write, create, list, mkdir, move, delete, stat. All paths are relative to the workspace root.",

  async execute(rawArgs, context?: ToolContext): Promise<ToolResponse> {
    if (!context?.workspaceRoot) {
      return { success: false, error: "filesystem tool requires a workspace context" };
    }

    const parsed = filesystemSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }
    const args = parsed.data;
    const root = context.workspaceRoot;

    try {
      switch (args.action) {
        case "read": {
          const target = resolveInWorkspace(root, args.path);
          const result = await readFile(target);
          return { success: true, data: result };
        }

        case "write": {
          const target = resolveInWorkspace(root, args.path);
          await writeFile({ path: target, content: args.content });
          return { success: true, data: { path: args.path, bytes: args.content.length } };
        }

        case "create": {
          const target = resolveInWorkspace(root, args.path);
          await createFile(target, args.content ?? "");
          return { success: true, data: { path: args.path } };
        }

        case "list": {
          const target = resolveInWorkspace(root, args.path);
          const entries = await listFiles(target);
          return { success: true, data: entries };
        }

        case "mkdir": {
          const target = resolveInWorkspace(root, args.path);
          await mkdir(target, args.recursive ?? true);
          return { success: true, data: { path: args.path } };
        }

        case "move": {
          const from = resolveInWorkspace(root, args.from);
          const to = resolveInWorkspace(root, args.to);
          await moveFile(from, to);
          return { success: true, data: { from: args.from, to: args.to } };
        }

        case "delete": {
          const check = canDeleteFile(args.path, root);
          if (!check.allowed) {
            return { success: false, error: check.reason };
          }
          const target = resolveInWorkspace(root, args.path);
          await deleteFile(target);
          return { success: true, data: { path: args.path } };
        }

        case "stat": {
          const target = resolveInWorkspace(root, args.path);
          const result = await statFile(target);
          return { success: true, data: result };
        }

        default:
          return { success: false, error: `Unknown action` };
      }
    } catch (err) {
      if (err instanceof PathTraversalError) {
        return { success: false, error: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },
};