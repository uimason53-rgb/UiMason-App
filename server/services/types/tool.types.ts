export interface ToolResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ToolContext {
  /** Absolute path to the sandboxed workspace this tool call is scoped to */
  workspaceRoot: string;
  userId?: string;
  sessionId?: string;
}

export interface Tool {
  name: string;
  description: string;
  /**
   * `context` is optional for backward compatibility, but the toolRegistry
   * always passes it. Tools that touch the filesystem/shell MUST use
   * context.workspaceRoot to stay sandboxed.
   */
  execute(args: any, context?: ToolContext): Promise<ToolResponse>;
}