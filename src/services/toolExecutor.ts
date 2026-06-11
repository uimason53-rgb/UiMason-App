// ─────────────────────────────────────────────────────────────
// toolExecutor.ts
// Runtime tool execution — maps tool calls to actual operations
// Works with in-memory GeneratedFile[] + WebContainer
// ─────────────────────────────────────────────────────────────

import type { GeneratedFile } from "./claudeService";
import type { ToolCall, ToolResult } from "../tools";
import { searchChunks, chunkProject } from "../rag/retrievalEngine";
import { verifyCode } from "./verificationEngine";
import { executeCommand } from "./sandboxService";

// ── In-memory file system (shared across tool calls) ─────────
let fileStore: GeneratedFile[] = [];

export const setFileStore = (files: GeneratedFile[]) => { fileStore = [...files]; };
export const getFileStore = (): GeneratedFile[] => fileStore;

// ── Execute a single tool call ───────────────────────────────
export const executeTool = async (toolCall: ToolCall): Promise<ToolResult> => {
  const { id, name, arguments: args } = toolCall;

  try {
    switch (name) {
      case "read_file": {
        const path = (args as Record<string,unknown>).path as string;
        const file = fileStore.find((f) => f.path === path);
        if (!file) return { toolCallId: id, name, success: false, output: `File not found: ${path}`, error: "NOT_FOUND" };
        const lines = (file.content ?? "").split("\n");
        const numbered = lines.map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n");
        return { toolCallId: id, name, success: true, output: numbered };
      }

      case "write_file": {
        const a = args as Record<string,unknown>;
        const path = a.path as string;
        const content = a.content as string;
        const idx = fileStore.findIndex((f) => f.path === path);
        if (idx >= 0) fileStore[idx] = { path, content };
        else fileStore.push({ path, content });
        return { toolCallId: id, name, success: true, output: `File written: ${path} (${content.length} chars)` };
      }

      case "edit_file": {
        const a = args as Record<string,unknown>;
        const path = a.path as string;
        const search = a.search as string;
        const replace = a.replace as string;
        const file = fileStore.find((f) => f.path === path);
        if (!file) return { toolCallId: id, name, success: false, output: `File not found: ${path}`, error: "NOT_FOUND" };
        const content = file.content ?? "";
        if (!content.includes(search)) return { toolCallId: id, name, success: false, output: `Search text not found in ${path}`, error: "NO_MATCH" };
        const newContent = content.replace(search, replace);
        const idx = fileStore.findIndex((f) => f.path === path);
        fileStore[idx] = { path, content: newContent };
        return { toolCallId: id, name, success: true, output: `Edited ${path}: replaced ${search.length} chars with ${replace.length} chars` };
      }

      case "delete_file": {
        const path = (args as Record<string,unknown>).path as string;
        const before = fileStore.length;
        fileStore = fileStore.filter((f) => f.path !== path);
        const deleted = before - fileStore.length;
        return { toolCallId: id, name, success: deleted > 0, output: deleted > 0 ? `Deleted: ${path}` : `File not found: ${path}` };
      }

      case "search_code": {
        const a = args as Record<string,unknown>;
        const query = a.query as string;
        const pattern = (a.filePattern as string) || undefined;
        let chunks = chunkProject(fileStore);
        if (pattern) chunks = chunks.filter((c) => c.filePath.match(new RegExp(pattern.replace("*", ".*"))));
        const results = searchChunks(chunks, query, 10);
        const output = results.length === 0
          ? "No matches found."
          : results.map((r, i) => `${i + 1}. ${r.chunk.filePath} (${r.chunk.type}): ${r.chunk.summary}`).join("\n");
        return { toolCallId: id, name, success: true, output };
      }

      case "list_files": {
        const dir = ((args as Record<string,unknown>).directory as string) || "";
        const filtered = dir ? fileStore.filter((f) => f.path.startsWith(dir)) : fileStore;
        const output = filtered.length === 0 ? "No files." : filtered.map((f) => `  ${f.path}`).join("\n");
        return { toolCallId: id, name, success: true, output: `${filtered.length} file(s):\n${output}` };
      }

      case "execute_command": {
        const cmd = (args as Record<string,unknown>).command as string;
        const [bin, ...rest] = cmd.split(" ");
        const result = await executeCommand(bin, rest);
        const output = result.success
          ? result.stdout.join("") || "(no output)"
          : `Exit ${result.exitCode}: ${result.stderr.join("")}`;
        return { toolCallId: id, name, success: result.success, output, error: result.success ? undefined : result.stderr.join("") };
      }

      case "analyze_file": {
        const path = (args as Record<string,unknown>).path as string;
        const file = fileStore.find((f) => f.path === path);
        if (!file) return { toolCallId: id, name, success: false, output: `File not found: ${path}`, error: "NOT_FOUND" };
        const result = verifyCode([file]);
        const output = result.passed ? `✓ No issues in ${path}` : `Issues in ${path}:\n${result.issues.map((i) => `  [${i.severity}] ${i.message}`).join("\n")}`;
        return { toolCallId: id, name, success: true, output };
      }

      default:
        return { toolCallId: id, name, success: false, output: `Unknown tool: ${name}`, error: "UNKNOWN_TOOL" };
    }
  } catch (err) {
    return { toolCallId: id, name, success: false, output: `Tool error: ${err instanceof Error ? err.message : "Unknown"}`, error: "RUNTIME_ERROR" };
  }
};

// ── Execute multiple tool calls in sequence ──────────────────
export const executeTools = async (toolCalls: ToolCall[]): Promise<ToolResult[]> => {
  const results: ToolResult[] = [];
  for (const call of toolCalls) {
    results.push(await executeTool(call));
  }
  return results;
};