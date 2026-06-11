// ─────────────────────────────────────────────────────────────
// deepseekService.ts
// Routes DeepSeek requests through backend /api/deepseek/chat
// All API keys are handled server-side only
// ─────────────────────────────────────────────────────────────

const BACKEND_DEEPSEEK_URL = "/api/deepseek/chat";
const MAX_TOOL_ITERATIONS = 5;

import type { GeneratedFile, ClaudeCodeResult } from "./claudeService";
import type { ProjectPlan } from "./openaiService";
import type { ToolCall } from "../tools/index";
import { PLANNER_PROMPT } from "../prompts";
import { assembleGeneratePromptWithMemory } from "./promptComposer";
import { buildContextBudget, composeContext } from "./contextEngine";
import { toOpenAITools } from "../tools/index";
import { setFileStore, getFileStore, executeTools } from "./toolExecutor";
import { emitToolCall, emitToolResult, emitDone, readSSEStream } from "./streamingService";
import { BUILDER_MODEL } from "./aiRuntime";
import { buildProjectContextPack } from "../memory/projectMemoryIndex";

const parseFilesFromResponse = (text: string): GeneratedFile[] => {
  const files: GeneratedFile[] = [];
  const fileRegex = /<file path="([^"]+)">\n?([\s\S]*?)\n?<\/file>/g;
  let match;
  while ((match = fileRegex.exec(text)) !== null) {
    files.push({ path: match[1].trim(), content: match[2].trim() });
  }
  if (files.length === 0) {
    const mdRegex = /###?\s+`?([^\n`]+)`?\n```[\w]*\n([\s\S]*?)```/g;
    while ((match = mdRegex.exec(text)) !== null) {
      const path = match[1].trim();
      if (path.includes(".") || path.includes("/")) {
        files.push({ path, content: match[2].trim() });
      }
    }
  }
  return files;
};

const parseToolArguments = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value !== "string") return value as Record<string, unknown>;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

// ── Project Planner via Backend DeepSeek ─────────────────────
export const planProjectDeepSeek = async (userPrompt: string): Promise<ProjectPlan> => {
  const result = await readSSEStream(BACKEND_DEEPSEEK_URL, {
    model: BUILDER_MODEL,
    max_tokens: 1500,
    temperature: 0.3,
    messages: [
      { role: "system", content: PLANNER_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  const raw: string = result.message?.content ?? "";

  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean) as ProjectPlan;
  } catch {
    throw new Error("Failed to parse project plan from DeepSeek response.");
  }
};

// ── System prompts ────────────────────────────────────────────

export const generateCodeDeepSeek = async (
  plan: string,
  userPrompt: string,
  existingFiles?: GeneratedFile[]
): Promise<ClaudeCodeResult> => {
  const isModification = existingFiles && existingFiles.length > 0;

  // ── Use unified prompt composer + context engine ──────────
  const { systemPrompt, userMessage } = await assembleGeneratePromptWithMemory(userPrompt, "deepseek", existingFiles);
  const finalUserMessage = !isModification && plan
    ? userMessage + `\n\nProject plan:\n${plan}\n\nGenerate all the project files now.`
    : userMessage;

  const budget = buildContextBudget(systemPrompt, [{ id: "ds-user", role: "user", content: finalUserMessage }], existingFiles, userPrompt, BUILDER_MODEL);
  composeContext(budget);

  // ── Initialize file store for tool calls ─────────────────
  if (existingFiles) setFileStore(existingFiles);

  // ── Multi-turn tool-use loop ─────────────────────────────
  const messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: finalUserMessage },
  ];

  let finalContent = "";
  let files: GeneratedFile[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const reader = await readSSEStream(BACKEND_DEEPSEEK_URL, {
      model: BUILDER_MODEL,
      max_tokens: 16000,
      temperature: 0.3,
      messages,
      tools: toOpenAITools(),
    });

    const streamResult = await reader;
    const rawChoice = streamResult?.message;
    if (!rawChoice) throw new Error("No response from DeepSeek");

    const choice = {
      content: rawChoice.content || null,
      tool_calls: rawChoice.tool_calls,
    };

    // Check for tool calls
    const toolCalls = choice.tool_calls as ToolCall[] | undefined;

    if (toolCalls && toolCalls.length > 0) {
      // Normalize OpenAI-format tool calls to our format
      const normalized: ToolCall[] = toolCalls.map((tc: Record<string, unknown>) => ({
        id: (tc.id || `tc-${Date.now()}`) as string,
        name: (tc.function as Record<string,string>)?.name || (tc.name as string) || "unknown",
        arguments: parseToolArguments((tc.function as Record<string, unknown>)?.arguments || tc.arguments),
      }));

      // Emit streaming events for tools
      normalized.forEach((tc) => emitToolCall(tc.name));

      // Execute tools
      const results = await executeTools(normalized);

      // Emit tool results
      results.forEach((r) => emitToolResult(r.success));

      // Add assistant message with tool calls
      messages.push({ role: "assistant", content: choice?.content || null, tool_calls: toolCalls });

      // Add tool results
      for (let i = 0; i < results.length; i++) {
        messages.push({
          role: "tool",
          content: results[i].output,
          tool_call_id: normalized[i].id,
        });
      }

      // Continue loop — model will process results
      continue;
    }

    // No tool calls — final response
    finalContent = choice?.content ?? "";
    files = parseFilesFromResponse(finalContent);

    // If tools were used during the loop, get files from store instead
    const storedFiles = getFileStore();
    if (storedFiles.length > 0 && iteration > 0) {
      files = storedFiles;
    }

    break;
  }

  emitDone();

  // If loop exhausted without content, use file store
  if (!finalContent) {
    files = getFileStore();
    finalContent = "";
  }

  const afterFiles = finalContent.replace(/<file[\s\S]*?<\/file>/g, "").trim();
  const summary =
    afterFiles
      .split("\n")
      .filter((l: string) => l.trim())
      .slice(-3)
      .join(" ")
      .trim() ||
    (isModification
      ? `Applied changes to ${files.length} files successfully.`
      : `Generated ${files.length} files successfully.`);

  if (files.length === 0) {
    throw new Error("DeepSeek Builder returned no files. Ask again with a clearer build request or check the DeepSeek API response format.");
  }

  return { files, summary, rawResponse: finalContent };
};

// ── UiMason AI Conversation (pre-build clarification) ────────

const SYSTEM_UIMASON_CHAT = `You are UiMason — a world-class AI software architect and senior full-stack developer. You build production-quality software for real companies and startups.

YOUR PERSONALITY:
• Direct, sharp, confident — like a senior tech lead at a top company
• You think carefully before building — never guess or assume
• Efficient: ask only the most important questions, no fluff
• Genuine enthusiasm for great software
• All communication in English

YOUR TASK:
Analyze the conversation and decide: do you have ENOUGH information to build a great project?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPTION 1 — Ready to build → respond with EXACTLY this format:
[[GENERATE]]
I'll build: [1-2 sentence description of what you'll build + tech stack]

OPTION 2 — Need clarification → ask questions naturally:
[Your message with 2-4 focused questions]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GENERATE IMMEDIATELY (no questions needed):
✓ Simple, clear requests: landing page, portfolio, calculator, todo, timer, quiz, game, dashboard UI
✓ Request already has enough technical detail
✓ User has answered your previous questions → ALWAYS respond with [[GENERATE]] now

ASK QUESTIONS WHEN:
✗ Vague business idea: "build me an app" / "create a platform" / "make a website"
✗ Complex systems that need scoping: e-commerce, SaaS, marketplace, CRM, booking system, social network
✗ Missing info that shapes the entire architecture (pick the 2-4 most critical):
  • User authentication / accounts needed?
  • Database / persistent data required?
  • Payment processing? (Stripe, PayPal)
  • Admin dashboard / management panel?
  • Specific pages / screens needed?
  • Mobile or web or both?
  • Any design style? (minimal, bold, glassmorphism, dark theme)

QUESTION FORMAT — be natural and engaging:
---
Exciting project! Before I start coding, I need to clarify a few things:

1. **[Question]** — [why it matters]
2. **[Question]** — [why it matters]
3. **[Question]** — [optional, only if needed]

Once you answer these, I'll start building right away! 🚀
---

RULES:
• English only — no other language
• Maximum 4 questions per response
• After user answers → ALWAYS respond with [[GENERATE]]
• Never ask questions about things the user already specified
• Be conversational, not robotic — you're a senior dev, not a form`;

export const chatWithDeepSeek = async (
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  onChunk?: (text: string) => void,
): Promise<{ shouldGenerate: boolean; message: string }> => {
  const result = await readSSEStream(BACKEND_DEEPSEEK_URL, {
    model: BUILDER_MODEL,
    max_tokens: 800,
    temperature: 0.6,
    messages: [
      { role: "system", content: SYSTEM_UIMASON_CHAT },
      ...messages,
    ],
  }, onChunk);
  const rawText: string = result.message?.content ?? "";

  const shouldGenerate = rawText.includes("[[GENERATE]]");
  const message = shouldGenerate
    ? rawText.replace("[[GENERATE]]", "").trim()
    : rawText.trim();

  return { shouldGenerate, message };
};

// ─────────────────────────────────────────────────────────────

const SYSTEM_FIX = `You are an expert debugger and full-stack developer. Your task is to fix errors in existing code.

RULES:
- Return ALL files (both fixed and unchanged) using <file path="..."> tags
- Fix ONLY the files with actual issues — do not change working code
- Preserve the original project structure and coding style
- Explain what was fixed in a 1-2 sentence summary after the files
- If the error is a syntax/type error → fix the specific lines
- If the error is a logic/runtime error → analyze root cause and fix systematically
- If the error is a missing dependency → add the required import/package
- If the error is ambiguous → make your best-informed fix and note any assumptions`;

export const fixCodeDeepSeek = async (
  originalFiles: GeneratedFile[],
  errorMessage: string,
  onChunk?: (text: string) => void
): Promise<ClaudeCodeResult> => {
  const memoryPack = await buildProjectContextPack(originalFiles, errorMessage, 5000);
  const filesText = originalFiles
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join("\n\n");

  const prompt = `ERROR REPORTED:
${errorMessage}

PROJECT MEMORY PACK:
${memoryPack.contextText}

EXISTING PROJECT FILES:
${filesText}

Fix the error(s) and return ALL files using the same <file path="..."> format.`;

  const result = await readSSEStream(BACKEND_DEEPSEEK_URL, {
    model: BUILDER_MODEL,
    max_tokens: 16000,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_FIX },
      { role: "user", content: prompt },
    ],
  });
  const rawResponse = result.message?.content ?? "";
  if (onChunk) onChunk(rawResponse);
  const files = parseFilesFromResponse(rawResponse);
  return { files, summary: "Errors fixed.", rawResponse };
};
