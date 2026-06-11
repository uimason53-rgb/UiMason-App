// ─────────────────────────────────────────────────────────────
// openaiService.ts
// Routes OpenAI requests through backend /api/openai/chat
// All API keys are handled server-side only
// ─────────────────────────────────────────────────────────────

import { PLANNER_PROMPT } from "../prompts";
import { aiJsonHeaders, BRAIN_MODEL, readApiError, shouldRetryResponse, withAiRetry } from "./aiRuntime";
import { readSSEStream } from "./streamingService";

const BACKEND_OPENAI_URL = "/api/openai/chat";
const BACKEND_OPENAI_STREAM_URL = "/api/openai/stream";

export type ProjectPlan = {
  projectName: string;
  description: string;
  stack: string[];          // e.g. ["React", "TypeScript", "Vite"]
  files: PlannedFile[];
  steps: string[];          // execution steps for the log
};

export type PlannedFile = {
  path: string;             // e.g. "src/App.tsx"
  purpose: string;          // e.g. "Main app component"
};

// ── Plan project from user prompt (via backend) ──────────────
export const planProject = async (userPrompt: string): Promise<ProjectPlan> => {
  const response = await withAiRetry(async () => {
    const res = await fetch(BACKEND_OPENAI_URL, {
      method: "POST",
      headers: aiJsonHeaders(),
      body: JSON.stringify({
        model: BRAIN_MODEL,
        max_tokens: 1500,
        temperature: 0.3,
        messages: [
          { role: "system", content: PLANNER_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (shouldRetryResponse(res)) throw new Error(await readApiError(res, "OpenAI Brain"));
    return res;
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "OpenAI Brain"));
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content ?? "";

  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const plan: ProjectPlan = JSON.parse(clean);
    return plan;
  } catch {
    throw new Error("Failed to parse project plan from GPT response.");
  }
};

export const brainChat = async (
  systemPrompt: string,
  userMessage: string,
  maxTokens = 8000,
  temperature = 0.3,
): Promise<string> => {
  const response = await withAiRetry(async () => {
    const res = await fetch(BACKEND_OPENAI_URL, {
      method: "POST",
      headers: aiJsonHeaders(),
      body: JSON.stringify({
        model: BRAIN_MODEL,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (shouldRetryResponse(res)) throw new Error(await readApiError(res, "OpenAI Brain"));
    return res;
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "OpenAI Brain"));
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content ?? "";
  return raw.replace(/```json|```/g, "").trim();
};

const SYSTEM_UIMASON_BRAIN_CHAT = `You are UiMason's Brain, powered by OpenAI GPT-5.5. You analyze user intent and decide whether the Builder should generate code.

MODEL ROLES:
- Brain: OpenAI GPT-5.5 handles planning, reasoning, clarification, architecture, review, and routing.
- Builder: DeepSeek V4 Pro writes, modifies, and repairs code.

Return exactly one of these modes:

Ready to build:
[[GENERATE]]
I'll build: [1-2 sentence build summary and stack]

Need clarification:
[Ask 2-4 focused questions]

Rules:
- Generate immediately for clear requests like landing pages, portfolios, calculators, games, dashboards, CRUD screens, or requests with enough technical detail.
- Ask questions only when missing product decisions would materially change the architecture.
- After the user answers previous questions, choose [[GENERATE]].
- Be concise and practical.`;

export const chatWithBrain = async (
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  onChunk?: (text: string) => void,
): Promise<{ shouldGenerate: boolean; message: string }> => {
  const result = await readSSEStream(BACKEND_OPENAI_STREAM_URL, {
    model: BRAIN_MODEL,
    max_tokens: 1200,
    temperature: 0.35,
    messages: [
      { role: "system", content: SYSTEM_UIMASON_BRAIN_CHAT },
      ...messages,
    ],
  }, onChunk);

  const rawText = result.message?.content ?? "";
  const shouldGenerate = rawText.includes("[[GENERATE]]");
  const message = shouldGenerate
    ? rawText.replace("[[GENERATE]]", "").trim()
    : rawText.trim();

  return { shouldGenerate, message };
};

// ── Fallback: plan without OpenAI (used when backend unavailable) ──
export const planProjectFallback = (userPrompt: string): ProjectPlan => {
  // Simple heuristic plan when backend is not available
  const name = userPrompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("-") || "my-app";

  return {
    projectName: name,
    description: userPrompt,
    stack: ["React", "TypeScript", "Vite", "CSS"],
    files: [
      { path: "src/App.tsx", purpose: "Main application component" },
      { path: "src/main.tsx", purpose: "Entry point" },
      { path: "src/App.css", purpose: "App styles" },
      { path: "src/index.css", purpose: "Global styles" },
      { path: "public/index.html", purpose: "HTML template" },
      { path: "package.json", purpose: "Dependencies" },
      { path: "tsconfig.json", purpose: "TypeScript config" },
      { path: "README.md", purpose: "Documentation" },
    ],
    steps: [
      "Analysing requirements",
      "Planning project structure",
      "Generating components",
      "Generating styles",
      "Writing config files",
      "Project ready",
    ],
  };
};
