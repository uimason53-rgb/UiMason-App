// ─────────────────────────────────────────────────────────────
// promptComposer.ts
// Dynamic prompt assembly — builds task-adaptive prompts based on
// user intent, language, framework, and preference signals
// ─────────────────────────────────────────────────────────────

import { GENERATE_PROMPT, MODIFY_PROMPT, FIX_PROMPT } from "../prompts";
import type { GeneratedFile } from "./claudeService";
import { generateStyleGuide } from "./learningEngine";
import { buildProjectContextPack, type ProjectContextPack } from "../memory/projectMemoryIndex";

// ── Task type classification ─────────────────────────────────
export type TaskType =
  | "generate_new"      // Fresh project from scratch
  | "modify_existing"   // Modify/upgrade existing code
  | "fix_error"         // Fix a specific error
  | "add_feature"       // Add a new feature/section
  | "refactor"          // Refactor/improve code
  | "debug"             // Debug a runtime issue
  | "add_animations"    // Add animations/polish
  | "add_dark_mode"     // Add dark theme
  | "redesign"          // Restyle while keeping functionality
  | "review_code"       // Code review / analysis
  | "unknown";

// ── Detected context ─────────────────────────────────────────
export type DetectedContext = {
  taskType: TaskType;
  language: string;
  framework: string;
  hasExistingFiles: boolean;
  fileCount: number;
  totalSizeKB: number;
  hasPreview: boolean;
  intentKeywords: string[];
};

// ── Classify user intent ─────────────────────────────────────
export const classifyTask = (userPrompt: string): TaskType => {
  const p = userPrompt.toLowerCase();

  // Error/fix detection
  if (
    /\b(fix|debug|broken|error|bug|not working|crash|fail)\b/.test(p) ||
    p.includes("doesn't work") ||
    p.includes("don't work")
  ) {
    // Distinguish between fix_error and debug
    if (
      /\b(runtime|console|log|trace|stack|exception|undefined reference|cannot read|cannot find|typeerror|syntaxerror)\b/.test(p)
    ) {
      return "debug";
    }
    return "fix_error";
  }

  // Dark mode
  if (
    p.includes("dark mode") ||
    p.includes("dark theme") ||
    p.includes("make it dark") ||
    p.includes("gelap")
  ) {
    return "add_dark_mode";
  }

  // Animations
  if (
    p.includes("animation") ||
    p.includes("animate") ||
    p.includes("motion") ||
    p.includes("transition") ||
    p.includes("gsap") ||
    /\b(add polish|smooth|polished|animated)\b/.test(p)
  ) {
    return "add_animations";
  }

  // Add feature
  if (
    /\b(add|tambah|include|implement|create a new)\b/.test(p) ||
    /\b(add a|add an|add the|new feature|new section|new page)\b/.test(p)
  ) {
    return "add_feature";
  }

  // Redesign
  if (
    p.includes("redesign") ||
    p.includes("restyle") ||
    p.includes("make it look") ||
    p.includes("change the design") ||
    p.includes("tukar design") ||
    p.includes("new look")
  ) {
    return "redesign";
  }

  // Refactor
  if (
    /\b(refactor|improve code|clean up|optimize|eslint|typescript strict|split component|extract)\b/.test(p)
  ) {
    return "refactor";
  }

  // Review
  if (
    /\b(review|analyze|audit|check|inspect|evaluate|code review)\b/.test(p) &&
    !/\b(build|create|generate|make|buat)\b/.test(p)
  ) {
    return "review_code";
  }

  // Modification (existing project context)
  if (
    /\b(upgrade|improve|enhance|update|change|modify|kemas kini|ubah|tukar)\b/.test(p)
  ) {
    return "modify_existing";
  }

  // Default: generate new
  return "generate_new";
};

// ── Detect framework from existing files ──────────────────────
export const detectFramework = (files: GeneratedFile[]): string => {
  const paths = files.map((f) => f.path.toLowerCase());
  const contents = files.map((f) => (f.content ?? "").toLowerCase());

  if (paths.some((p) => p.startsWith("next.config") || p.match(/app\/.*page\.tsx/))) return "Next.js";
  if (paths.some((p) => p.endsWith(".svelte"))) return "Svelte";
  if (paths.some((p) => p.endsWith(".vue"))) return "Vue.js";
  if (paths.some((p) => p.endsWith(".tsx") || p.endsWith(".jsx"))) return "React";
  if (paths.some((p) => p.endsWith(".py"))) return "Python";
  if (paths.some((p) => p.endsWith(".go"))) return "Go";
  if (paths.some((p) => p.includes("tailwind"))) return "React+Tailwind";

  const allContent = contents.join(" ");
  if (allContent.includes("from \"react\"")) return "React";
  if (allContent.includes("from 'react'")) return "React";
  if (allContent.includes("next/")) return "Next.js";
  if (allContent.includes("@tailwind")) return "React+Tailwind";

  return "Unknown";
};

// ── Build persona/personality injection ───────────────────────
const getPersonaInjection = (taskType: TaskType): string => {
  switch (taskType) {
    case "fix_error":
      return "Act as a meticulous debugger. Be methodical — identify the root cause, fix only what's broken, and explain your fix.";
    case "debug":
      return "Act as a senior debugger analyzing a runtime issue. Look for the root cause systematically. Consider edge cases, race conditions, and type errors.";
    case "add_feature":
      return "Act as a senior developer adding a feature to an existing codebase. Match the existing patterns and conventions exactly. Do not refactor unrelated code.";
    case "refactor":
      return "Act as a code quality engineer. Improve readability, reduce duplication, and follow best practices without changing functionality.";
    case "add_animations":
      return "Act as a creative frontend developer specializing in animation. Use CSS keyframes, transitions, and optionally GSAP for smooth, professional motion.";
    case "add_dark_mode":
      return "Act as a theming specialist. Implement a clean dark mode using CSS custom properties (variables). Ensure all components adapt properly.";
    case "redesign":
      return "Act as a UI/UX designer-turned-developer. Redesign with modern aesthetics while preserving all existing functionality and logic.";
    case "review_code":
      return "Act as a code reviewer. Analyze the codebase and provide actionable feedback on structure, performance, security, and best practices.";
    default:
      return "Act as an expert full-stack developer building production-quality software.";
  }
};

// ── Build few-shot examples for the task type ─────────────────
const getFewShotExamples = (
  taskType: TaskType
): string => {
  if (taskType === "fix_error") {
    return `EXAMPLE — Fix a missing import:
<file path="src/App.tsx">
import { useState } from 'react';
import './App.css';
// FIX: Added missing useEffect import for the hook used on line 15
import { useEffect } from 'react';
...
</file>`;
  }

  if (taskType === "add_dark_mode") {
    return `EXAMPLE — Add dark mode via CSS variables:
<file path="src/index.css">
:root {
  --bg: #ffffff;
  --text: #1a1a1a;
  --primary: #3b82f6;
}
[data-theme="dark"] {
  --bg: #0f172a;
  --text: #e2e8f0;
  --primary: #60a5fa;
}
body { background: var(--bg); color: var(--text); }
</file>`;
  }

  if (taskType === "add_animations") {
    return `EXAMPLE — Add subtle entrance animation:
<file path="src/App.css">
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-in { animation: fadeInUp 0.6s ease forwards; }
</file>`;
  }

  return "";
};

// ── MAIN: Compose dynamic system prompt ──────────────────────
export const composeSystemPrompt = (
  taskType: TaskType,
  provider: "openai" | "deepseek",
  context?: Partial<DetectedContext>
): string => {
  const basePrompt =
    taskType === "modify_existing" || taskType === "add_feature" ||
    taskType === "add_animations" || taskType === "add_dark_mode" ||
    taskType === "redesign"
      ? MODIFY_PROMPT
      : taskType === "fix_error" || taskType === "debug" || taskType === "refactor"
        ? FIX_PROMPT
        : GENERATE_PROMPT;

  const persona = getPersonaInjection(taskType);
  const examples = getFewShotExamples(taskType);

  let composed = `${basePrompt}\n\n${persona}`;

  // Inject framework context
  if (context?.framework && context.framework !== "Unknown") {
    composed += `\n\nPROJECT CONTEXT: This is a ${context.framework} project. Use ${context.framework} conventions and patterns.`;
  }

  // Inject file count context
  if (context?.fileCount && context.fileCount > 5) {
    composed += `\nThe project has ${context.fileCount} files. Be precise — only modify files that need changing.`;
  }

  // Inject few-shot examples
  if (examples) {
    composed += `\n\n${examples}`;
  }

  // Inject learned style preferences
  const styleGuide = generateStyleGuide();
  if (styleGuide) {
    composed += `\n\n${styleGuide}`;
  }

  return composed;
};

// ── Compose user message with context ─────────────────────────
export const composeUserMessage = (
  userPrompt: string,
  taskType: TaskType,
  existingFiles?: GeneratedFile[],
  plan?: string
): string => {
  const taskLabels: Record<TaskType, string> = {
    generate_new: "BUILD REQUEST",
    modify_existing: "MODIFICATION REQUEST",
    fix_error: "FIX REQUEST",
    add_feature: "FEATURE ADDITION",
    refactor: "REFACTOR REQUEST",
    debug: "DEBUG REQUEST",
    add_animations: "ANIMATION REQUEST",
    add_dark_mode: "DARK MODE REQUEST",
    redesign: "REDESIGN REQUEST",
    review_code: "CODE REVIEW",
    unknown: "REQUEST",
  };

  const label = taskLabels[taskType] ?? "REQUEST";

  if (existingFiles && existingFiles.length > 0) {
    const filesContext = existingFiles
      .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
      .join("\n\n");

    return `[${label}]\n\nEXISTING PROJECT FILES:\n${filesContext}\n\nUSER INSTRUCTION: "${userPrompt}"\n\nApply the requested changes intelligently. Return ALL files (modified and unmodified).`;
  }

  if (plan) {
    return `[${label}]\n\nUser request: ${userPrompt}\n\nProject plan:\n${plan}\n\nGenerate all the project files now.`;
  }

  return `[${label}]\n\n${userPrompt}`;
};

// ── Compose the fix-code message ──────────────────────────────
export const composeFixMessage = (
  errorMessage: string,
  files: GeneratedFile[]
): string => {
  const filesText = files
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join("\n\n");

  return `ERROR REPORTED:\n${errorMessage}\n\nEXISTING PROJECT FILES:\n${filesText}\n\nFix the error(s) and return ALL files using the same <file path="..."> format.`;
};

// ── Convenience: full prompt assembly for generateCode ────────
export const assembleGeneratePrompt = (
  userPrompt: string,
  provider: "openai" | "deepseek",
  existingFiles?: GeneratedFile[]
): { systemPrompt: string; userMessage: string; taskType: TaskType } => {
  const taskType = classifyTask(userPrompt);
  const framework = existingFiles ? detectFramework(existingFiles) : "Unknown";
  const fileCount = existingFiles?.length ?? 0;
  const totalSizeKB = existingFiles
    ? Math.ceil(
        existingFiles.reduce((sum, f) => sum + (f.content?.length ?? 0), 0) / 1024
      )
    : 0;

  const context: DetectedContext = {
    taskType,
    language: "TypeScript",
    framework,
    hasExistingFiles: (existingFiles?.length ?? 0) > 0,
    fileCount,
    totalSizeKB,
    hasPreview: existingFiles?.some((f) => f.path === "preview.html") ?? false,
    intentKeywords: [],
  };

  const systemPrompt = composeSystemPrompt(taskType, provider, context);
  const userMessage = composeUserMessage(
    userPrompt,
    taskType,
    existingFiles?.length ? existingFiles : undefined,
    undefined
  );

  return { systemPrompt, userMessage, taskType };
};

export const assembleGeneratePromptWithMemory = async (
  userPrompt: string,
  provider: "openai" | "deepseek",
  existingFiles?: GeneratedFile[],
  maxMemoryTokens = 6000
): Promise<{ systemPrompt: string; userMessage: string; taskType: TaskType; memoryPack?: ProjectContextPack }> => {
  const base = assembleGeneratePrompt(userPrompt, provider, existingFiles);

  if (!existingFiles?.length) {
    return base;
  }

  const memoryPack = await buildProjectContextPack(existingFiles, userPrompt, maxMemoryTokens);
  const systemPrompt = `${base.systemPrompt}

PROJECT MEMORY RULES:
- Use the project memory pack as the highest-priority local context.
- Prefer the listed entry files, symbols, imports, exports, and relevant code chunks when deciding what to edit.
- Preserve existing architecture, file names, styling conventions, and component boundaries.
- If the full file dump and memory pack disagree, trust the full file dump for exact code and trust the memory pack for navigation/context.
- Do not invent files when an existing file should be modified.`;

  const userMessage = `[PROJECT MEMORY PACK]
${memoryPack.contextText}

${base.userMessage}`;

  return { ...base, systemPrompt, userMessage, memoryPack };
};
