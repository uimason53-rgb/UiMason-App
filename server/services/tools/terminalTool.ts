// ─────────────────────────────────────────────────────────────
// server/services/tools/terminalTool.ts
// Sandboxed shell command execution for agents.
// Commands run with cwd pinned to the workspace root, are checked
// against canExecuteCommand(), and are killed after a timeout.
// ─────────────────────────────────────────────────────────────
import { exec } from "child_process";
import type { Tool, ToolContext, ToolResponse } from "../types/tool.types";
import { terminalSchema } from "../schemas/toolSchemas";
import { canExecuteCommand } from "./permissions/canExecuteCommand";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Low-level runner used by terminalTool and elsewhere (e.g. sandboxRunner).
 * Always pins cwd and applies a hard timeout.
 */
export function executeCommand(command: string, cwd: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = exec(command, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const timedOut = !!error && (error as any).killed && (error as any).signal === "SIGTERM";
      resolve({
        stdout: truncate(stdout?.toString() ?? ""),
        stderr: truncate(stderr?.toString() ?? ""),
        exitCode: error ? (typeof (error as any).code === "number" ? (error as any).code : 1) : 0,
        timedOut,
      });
    });
    void child;
  });
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + "\n...(truncated)" : text;
}

export const terminalTool: Tool = {
  name: "terminal",

  description:
    "Run a shell command inside the current workspace. The command is checked against an allowlist " +
    "of safe binaries and a blocklist of dangerous patterns before execution.",

  async execute(rawArgs, context?: ToolContext): Promise<ToolResponse> {
    if (!context?.workspaceRoot) {
      return { success: false, error: "terminal tool requires a workspace context" };
    }

    const parsed = terminalSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return { success: false, error: `Invalid arguments: ${parsed.error.message}` };
    }
    const { command, timeoutMs } = parsed.data;

    const check = canExecuteCommand(command);
    if (!check.allowed) {
      return { success: false, error: `Command blocked: ${check.reason}` };
    }

    try {
      const result = await executeCommand(command, context.workspaceRoot, timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return {
        success: result.exitCode === 0 && !result.timedOut,
        data: result,
        error: result.timedOut ? "Command timed out" : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },
};