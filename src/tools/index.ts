// ─────────────────────────────────────────────────────────────
// tools/index.ts
// Native tool definitions — OpenAI/Anthropic function-calling
// compatible tool schemas for the coding agent
// ─────────────────────────────────────────────────────────────

export type ToolSchema = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  toolCallId: string;
  name: string;
  success: boolean;
  output: string;
  error?: string;
};

export const READ_FILE_TOOL: ToolSchema = {
  name: "read_file",
  description: "Read the contents of a file from the project with line numbers.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "File path relative to project root" } },
    required: ["path"],
  },
};

export const WRITE_FILE_TOOL: ToolSchema = {
  name: "write_file",
  description: "Create or overwrite a file with new content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to project root" },
      content: { type: "string", description: "Complete file content" },
    },
    required: ["path", "content"],
  },
};

export const EDIT_FILE_TOOL: ToolSchema = {
  name: "edit_file",
  description: "Make targeted edits using search-and-replace. Prefer this over write_file for small changes.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to edit" },
      search: { type: "string", description: "Exact content to find" },
      replace: { type: "string", description: "New content to replace with" },
    },
    required: ["path", "search", "replace"],
  },
};

export const DELETE_FILE_TOOL: ToolSchema = {
  name: "delete_file",
  description: "Delete a file from the project.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "File path to delete" } },
    required: ["path"],
  },
};

export const SEARCH_CODE_TOOL: ToolSchema = {
  name: "search_code",
  description: "Search for text or regex across all project files. Returns matches with context.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text or regex pattern to search for" },
      filePattern: { type: "string", description: "Optional glob filter, e.g. '*.ts'" },
    },
    required: ["query"],
  },
};

export const LIST_FILES_TOOL: ToolSchema = {
  name: "list_files",
  description: "List all files in the project directory tree.",
  parameters: {
    type: "object",
    properties: { directory: { type: "string", description: "Optional directory. Defaults to root." } },
    required: [],
  },
};

export const EXECUTE_COMMAND_TOOL: ToolSchema = {
  name: "execute_command",
  description: "Execute a shell command (npm, node, git, etc).",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      workingDirectory: { type: "string", description: "Optional working directory" },
    },
    required: ["command"],
  },
};

export const ANALYZE_FILE_TOOL: ToolSchema = {
  name: "analyze_file",
  description: "Analyze a file for syntax errors, lint issues, or TypeScript type errors.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "File path to analyze" } },
    required: ["path"],
  },
};

export const ALL_TOOLS: ToolSchema[] = [
  READ_FILE_TOOL, WRITE_FILE_TOOL, EDIT_FILE_TOOL, DELETE_FILE_TOOL,
  SEARCH_CODE_TOOL, LIST_FILES_TOOL, EXECUTE_COMMAND_TOOL, ANALYZE_FILE_TOOL,
];

export const toOpenAITools = () =>
  ALL_TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

export const toAnthropicTools = () =>
  ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: t.parameters.properties,
      required: t.parameters.required,
    },
  }));