// aiService (legacy filename)
// UiMason model roles are fixed:
// - Brain: OpenAI GPT-5.5 for planning, analysis, review, and orchestration.
// - Builder: DeepSeek V4 Pro for code generation and code repair.

export type GeneratedFile = {
  path: string;
  content: string;
};

export type ClaudeCodeResult = {
  files: GeneratedFile[];
  summary: string;
  rawResponse: string;
};

export const getActiveProvider = (): "openai" | "deepseek" => {
  // Backward-compatible helper for older call sites. Code writing is locked to
  // the DeepSeek Builder role regardless of legacy settings.
  return "deepseek";
};

export const generateCode = async (
  plan: string,
  userPrompt: string,
  onChunk?: (text: string) => void,
  existingFiles?: GeneratedFile[]
): Promise<ClaudeCodeResult> => {
  const { generateCodeDeepSeek } = await import("./deepseekService");
  const result = await generateCodeDeepSeek(plan, userPrompt, existingFiles);
  if (onChunk && result.rawResponse) onChunk(result.rawResponse);
  return result;
};

export const fixCode = async (
  originalFiles: GeneratedFile[],
  errorMessage: string,
  onChunk?: (text: string) => void
): Promise<ClaudeCodeResult> => {
  const { fixCodeDeepSeek } = await import("./deepseekService");
  return fixCodeDeepSeek(originalFiles, errorMessage, onChunk);
};
