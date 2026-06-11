// ─────────────────────────────────────────────────────────────
// agents/orchestrator.ts
// Real LLM-driven multi-agent mesh with self-healing loop
// Supports fresh generation AND targeted editing of existing projects
// ─────────────────────────────────────────────────────────────

import type { AgentRole, ArchitecturePlan, ReviewResult, DebugResult, ReviewIssue, ChangePlan } from "./types";
import { generateCode } from "../services/claudeService";
import type { GeneratedFile } from "../services/claudeService";
import type { ProjectPlan } from "../services/openaiService";
import { fixCodeDeepSeek } from "../services/deepseekService";
import { runBuildPipeline } from "../services/sandboxService";
import { runRepairLoop } from "../services/repairLoop";
import { buildCodebaseMap, generateArchitectureSummary, type CodebaseMap } from "../search/codebaseIndexer";
import { getRelevantFiles, buildChangePlan, type RelevantFileResult } from "../search/relevantFiles";
import { aiJsonHeaders, BRAIN_MODEL, readApiError, shouldRetryResponse, withAiRetry } from "../services/aiRuntime";

const MAX_ITERATIONS = 3;
const MAX_RELEVANT_FILES = 15;

// ── Build verification result ────────────────────────────────
type BuildVerificationResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
  buildOutput: string;
  iteration: number;
};

// ── Shared Brain call helper (GPT-5.5) ─────────────────────────
const callBrain = async (systemPrompt: string, userMessage: string, temperature = 0.3, maxTokens = 4000): Promise<string> => {
  const response = await withAiRetry(async () => {
    const res = await fetch("/api/openai/chat", {
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

// ═════════════════════════════════════════════════════════════
// 1. ARCHITECT AGENT
// ═════════════════════════════════════════════════════════════
const ARCHITECT_SYSTEM = `You are a senior software architect. Design the optimal architecture.

Return JSON: {"projectName":"...","description":"...","architecture":"...","stack":[...],"decisions":[{...}],"componentTree":"...","dataFlow":"...","risks":[...]}
Rules: 3-5 decisions, specific stack names, no markdown fences, ONLY the JSON object.`;

const architectAgent = async (prompt: string): Promise<ArchitecturePlan> => {
  try {
    const raw = await callBrain(ARCHITECT_SYSTEM, prompt, 0.4, 3000);
    return JSON.parse(raw) as ArchitecturePlan;
  } catch {
    const name = prompt.slice(0, 30).replace(/[^a-z0-9]/g, "-").toLowerCase();
    return { projectName: name || "my-project", description: prompt, architecture: "SPA with React + Vite",
      stack: ["React","TypeScript","Vite","Tailwind CSS"], decisions: [{ decision:"React SPA", rationale:"Best for interactive UIs", alternatives:["Vue"], tradeoffs:"Bundle size" }],
      componentTree:"App → Layout → Pages → Components", dataFlow:"Unidirectional props + React hooks", risks:[] };
  }
};

// ═════════════════════════════════════════════════════════════
// 2. PLANNER AGENT
// ═════════════════════════════════════════════════════════════
const PLANNER_SYSTEM = `You are a senior technical planner. Create a detailed file generation plan.

Return JSON: {"projectName":"...","description":"...","stack":[...],"files":[{"path":"...","purpose":"..."}],"steps":[...]}
Rules: 6-20 files, always include package.json/tsconfig.json/index.html/preview.html/src/main.tsx/src/App.tsx, 5-8 steps, no markdown fences.`;

const TARGETED_PLANNER_SYSTEM = `You are a senior developer. Given an existing project and a modification request, create a TARGETED edit plan. Modify ONLY the files that need changing. Do NOT regenerate the entire project.

CRITICAL RULES:
- Modify ONLY files listed in the change plan
- Create new files ONLY when absolutely necessary
- NEVER delete files unless explicitly requested
- Return ALL files (modified + unchanged) but mark modifications

Input: Architecture summary, relevant file contents, and user request.

Return JSON: {"projectName":"same","description":"summary","stack":[...],"files":[...ALL files with modifications applied...],"steps":["Step 1: Update landing page","Step 2: Add payment form",...]}`;

const plannerAgent = async (arch: ArchitecturePlan, prompt: string): Promise<ProjectPlan> => {
  try {
    const input = JSON.stringify({ architecture: arch, userRequest: prompt });
    const raw = await callBrain(PLANNER_SYSTEM, input, 0.3, 4000);
    return JSON.parse(raw) as ProjectPlan;
  } catch {
    return { projectName: arch.projectName, description: arch.description, stack: arch.stack,
      files: [{ path:"src/App.tsx", purpose:"Main"},{ path:"src/main.tsx", purpose:"Entry"},{ path:"src/App.css", purpose:"Styles"},
        { path:"src/index.css", purpose:"Global"},{ path:"public/index.html", purpose:"HTML"},{ path:"package.json", purpose:"Deps"},
        { path:"tsconfig.json", purpose:"TS"},{ path:"preview.html", purpose:"Preview"}],
      steps: ["Analyzing","Planning","Generating","Verifying"] };
  }
};

const targetedPlanner = async (prompt: string, codebaseMap: CodebaseMap, relevantFiles: RelevantFileResult[],
  existingFiles: GeneratedFile[]): Promise<ProjectPlan> => {
  try {
    const archSummary = generateArchitectureSummary(codebaseMap);
    const relevantContent = existingFiles
      .filter((f) => relevantFiles.some((r) => r.path === f.path))
      .map((f) => `### ${f.path}\n\`\`\`\n${(f.content ?? "").slice(0, 1500)}\n\`\`\``).join("\n\n");
    const input = `ARCHITECTURE:\n${archSummary}\n\nRELEVANT FILES:\n${relevantContent}\n\nUSER REQUEST:\n${prompt}\n\nCreate a TARGETED edit plan. Modify only relevant files. Return ALL files.`;
    const raw = await callBrain(TARGETED_PLANNER_SYSTEM, input, 0.3, 6000);
    return JSON.parse(raw) as ProjectPlan;
  } catch {
    const name = prompt.slice(0, 30).replace(/[^a-z0-9]/g, "-").toLowerCase();
    return { projectName: name || "edit", description: prompt, stack: codebaseMap.framework ? [codebaseMap.framework] : ["React"],
      files: existingFiles.map((f) => ({ path: f.path, purpose: "modified" })),
      steps: ["Analyzing request", "Targeting relevant files", "Applying modifications", "Verifying"] };
  }
};

// ═════════════════════════════════════════════════════════════
// 3. EXECUTOR AGENT
// ═════════════════════════════════════════════════════════════
const executorAgent = async (plan: ProjectPlan, prompt: string, existingFiles?: GeneratedFile[]) => {
  const result = await generateCode(JSON.stringify(plan), prompt, undefined, existingFiles);
  return { files: result.files, summary: result.summary };
};

// ═════════════════════════════════════════════════════════════
// 4. REVIEWER AGENT
// ═════════════════════════════════════════════════════════════
const reviewerAgent = async (files: GeneratedFile[]): Promise<ReviewResult> => {
  if (files.length === 0) return { files, issues: [], score: 100, summary: "No files", passed: true };
  try {
    const fileList = files.map((f) => `### ${f.path}\n\`\`\`\n${(f.content ?? "").slice(0, 2000)}\n\`\`\``).join("\n\n");
    const raw = await callBrain(`You are a senior code reviewer. Review files for quality, security, performance.
Return JSON: {"issues":[{...}],"score":85,"summary":"..."}. Max 5 issues, no markdown fences.`, fileList, 0.2, 4000);
    const parsed = JSON.parse(raw);
    return { files, issues: (parsed.issues || []) as ReviewIssue[], score: parsed.score ?? 75, summary: parsed.summary || "Done", passed: (parsed.score ?? 75) >= 70 };
  } catch {
    const issues: ReviewIssue[] = [];
    for (const f of files) {
      const c = f.content ?? "";
      if (/\b(sk-|api_key|secret_key|password\s*=\s*['"][^'"]+['"])/.test(c)) issues.push({ filePath:f.path, severity:"critical", category:"security", description:"Exposed secret", suggestion:"Use env vars" });
      if (/TODO|FIXME|placeholder|PLACEHOLDER/.test(c)) issues.push({ filePath:f.path, severity:"warning", category:"style", description:"Placeholder", suggestion:"Complete" });
    }
    const score = issues.length === 0 ? 90 : issues.some((i) => i.severity === "critical") ? 55 : 75;
    return { files, issues, score, summary: `${issues.length} issue(s)`, passed: score >= 70 };
  }
};

// ═════════════════════════════════════════════════════════════
// 5. BUILD VERIFIER
// ═════════════════════════════════════════════════════════════
const buildVerifier = async (files: GeneratedFile[], iteration: number): Promise<BuildVerificationResult> => {
  try {
    const result = await runBuildPipeline(files);
    return { passed: result.success, errors: result.errors, warnings: result.warnings, buildOutput: result.allOutput.slice(0, 2000), iteration };
  } catch (err) {
    return { passed: false, errors: [err instanceof Error ? err.message : "Build pipeline unavailable"], warnings: [], buildOutput: "", iteration };
  }
};

// ═════════════════════════════════════════════════════════════
// 6. DEBUGGER AGENT
// ═════════════════════════════════════════════════════════════
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const debuggerAgent = async (files: GeneratedFile[], review: ReviewResult, buildErrors?: string[]): Promise<DebugResult> => {
  const reviewErrors = review.issues.filter((i) => i.severity === "critical" || i.severity === "warning")
    .map((i) => `[${i.filePath}] ${i.severity}: ${i.description} — ${i.suggestion}`).join("\n");
  const buildMsg = (buildErrors || []).join("\n");
  const errorMessage = [reviewErrors, buildMsg].filter(Boolean).join("\n\n");
  if (!errorMessage.trim()) return { originalFiles: files, fixedFiles: files, rootCause: "None", fixApplied: "No fixes needed", confidence: 1, filesChanged: [] };
  try {
    const result = await fixCodeDeepSeek(files, errorMessage);
    const filesChanged = new Set<string>();
    for (const nf of result.files) { const orig = files.find((f) => f.path === nf.path); if (!orig || orig.content !== nf.content) filesChanged.add(nf.path); }
    return { originalFiles:files, fixedFiles:result.files.length>0?result.files:files, rootCause:review.issues.map(i=>i.description).join("; "), fixApplied:result.summary, confidence:0.75, filesChanged:[...filesChanged] };
  } catch {
    return { originalFiles:files, fixedFiles:files, rootCause:review.issues.map(i=>i.description).join("; "), fixApplied:"Fix failed", confidence:0.3, filesChanged:review.issues.map(i=>i.filePath) };
  }
};

// ═════════════════════════════════════════════════════════════
// AGENT TRACE
// ═════════════════════════════════════════════════════════════
export type AgentTraceEntry = {
  role: AgentRole; status: "success" | "error" | "fallback"; input: string; output: unknown; duration: number; timestamp: number; iteration?: number;
};

export type AgentTrace = {
  architect?: AgentTraceEntry; planner?: AgentTraceEntry; executor?: AgentTraceEntry; reviewer?: AgentTraceEntry;
  buildVerifier?: AgentTraceEntry[]; debugger?: AgentTraceEntry[];
  changePlan?: ChangePlan;
  relevantFiles?: RelevantFileResult[];
  codebaseMap?: CodebaseMap;
};

// ═════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═════════════════════════════════════════════════════════════
export type MeshCallbacks = {
  onPhaseChange: (p: string) => void;
  onFilesReady: (f: GeneratedFile[]) => void;
  onPlanReady: (p: ProjectPlan) => void;
  onChangePlan?: (cp: ChangePlan) => void;
};

const traceEntry = (role: AgentRole, status: "success" | "error" | "fallback", input: string, output: unknown, duration: number, iteration?: number): AgentTraceEntry =>
  ({ role, status, input: input.slice(0, 500), output, duration, timestamp: Date.now(), iteration });

export async function runAgentMesh(
  prompt: string, cb: MeshCallbacks, existing?: GeneratedFile[]
): Promise<{ files: GeneratedFile[]; plan: ProjectPlan | null; trace: AgentTrace; deployReady: boolean }> {
  const trace: AgentTrace = {};
  let plan: ProjectPlan | null;
  let files: GeneratedFile[] = existing || [];
  let deployReady = false;
  const isExistingProject = existing && existing.length > 0;

  if (isExistingProject) {
    // ═══════════════════════════════════════════════════════
    // TARGETED EDITING MODE — existing project
    // ═══════════════════════════════════════════════════════
    const t0 = Date.now();
    cb.onPhaseChange("indexing");

    // Build codebase map
    const codebaseMap = buildCodebaseMap(existing);
    trace.codebaseMap = codebaseMap;

    // Get relevant files
    const relevant = getRelevantFiles(prompt, codebaseMap, MAX_RELEVANT_FILES);
    trace.relevantFiles = relevant;

    // Build change plan
    const changePlan = buildChangePlan(prompt, existing, relevant);
    trace.changePlan = changePlan;
    if (cb.onChangePlan) cb.onChangePlan(changePlan);

    cb.onPhaseChange("planning");
    plan = await targetedPlanner(prompt, codebaseMap, relevant, existing);
    trace.planner = traceEntry("planner", "success", `${relevant.length} relevant files`, plan, Date.now() - t0);
    cb.onPlanReady(plan);
  } else {
    // ═══════════════════════════════════════════════════════
    // FRESH GENERATION MODE
    // ═══════════════════════════════════════════════════════
    cb.onPhaseChange("architecture");
    let t0 = Date.now();
    try { const arch = await architectAgent(prompt); trace.architect = traceEntry("architect", "success", prompt, arch, Date.now() - t0); }
    catch { const fb: ArchitecturePlan = { projectName: prompt.slice(0,30).replace(/[^a-z0-9]/g,"-").toLowerCase(), description: prompt, architecture: "SPA", stack: ["React","TypeScript","Vite"], decisions: [{ decision:"React SPA", rationale:"Default", alternatives:[], tradeoffs:"" }], componentTree:"App→Layout→Pages→Components", dataFlow:"Unidirectional", risks:[] }; trace.architect = traceEntry("architect", "fallback", prompt, fb, Date.now() - t0); }

    cb.onPhaseChange("planning");
    t0 = Date.now();
    try { plan = await plannerAgent(trace.architect!.output as ArchitecturePlan, prompt); trace.planner = traceEntry("planner", "success", JSON.stringify(trace.architect!.output), plan, Date.now() - t0); }
    catch { plan = { projectName: (trace.architect?.output as ArchitecturePlan)?.projectName || "my-project", description: prompt, stack: ["React","TypeScript","Vite","CSS"], files: [{ path:"src/App.tsx", purpose:"Main" },{ path:"src/main.tsx", purpose:"Entry" },{ path:"src/App.css", purpose:"Styles" },{ path:"public/index.html", purpose:"HTML" },{ path:"package.json", purpose:"Deps" },{ path:"preview.html", purpose:"Preview" }], steps: ["Analyzing","Planning","Generating"] } as ProjectPlan; trace.planner = traceEntry("planner", "fallback", prompt, plan, Date.now() - t0); }
    cb.onPlanReady(plan);
  }

  // ── EXECUTOR ─────────────────────────────────────────────
  cb.onPhaseChange("execution");
  let t0 = Date.now();
  try {
    const exec = await executorAgent(plan!, prompt, isExistingProject ? existing : undefined);
    files = exec.files;
    cb.onFilesReady(files);
    trace.executor = traceEntry("executor", "success", `${files.length} files`, { fileCount: files.length, summary: exec.summary }, Date.now() - t0);
  } catch (err) {
    trace.executor = traceEntry("executor", "error", prompt, { error: String(err) }, Date.now() - t0);
  }
  if (files.length === 0) { cb.onPhaseChange("done"); return { files, plan, trace, deployReady: false }; }

  // ── REVIEWER ─────────────────────────────────────────────
  cb.onPhaseChange("review");
  t0 = Date.now();
  let review: ReviewResult;
  try { review = await reviewerAgent(files); trace.reviewer = traceEntry("reviewer", "success", `${files.length} files`, review, Date.now() - t0); }
  catch { review = { files, issues: [], score: 80, summary: "Skipped", passed: true }; trace.reviewer = traceEntry("reviewer", "error", "", review, Date.now() - t0); }

  // ═══════════════════════════════════════════════════════════
  // ITERATIVE SELF-HEALING LOOP (max 3)
  // ═══════════════════════════════════════════════════════════
  const buildTraceEntries: AgentTraceEntry[] = [];
  const debugTraceEntries: AgentTraceEntry[] = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    cb.onPhaseChange(`iteration-${iteration}`);
    cb.onPhaseChange("build-verification");
    t0 = Date.now();
    let verifyResult: BuildVerificationResult;
    try { verifyResult = await buildVerifier(files, iteration); }
    catch (err) { verifyResult = { passed: false, errors: [String(err)], warnings: [], buildOutput: "", iteration }; }
    buildTraceEntries.push(traceEntry("buildVerifier", verifyResult.passed ? "success" : "error", `Iter ${iteration}: ${files.length} files`, verifyResult, Date.now() - t0, iteration));
    if (verifyResult.passed) { cb.onPhaseChange("build-passed"); deployReady = true; break; }

    cb.onPhaseChange("build-failed");
    cb.onPhaseChange("debug");
    t0 = Date.now();
    try {
      const repairResult = await runRepairLoop(files, {
        maxAttempts: MAX_ITERATIONS - iteration + 1,
        fixFn: async (originalFiles, errorMessage, onChunk) => {
          const fixed = await fixCodeDeepSeek(originalFiles, errorMessage, onChunk);
          return { files: fixed.files };
        },
        onChunk: undefined,
        log: (type, message) => {
          debugTraceEntries.push(traceEntry("debugger", type === "error" ? "error" : "success", `Attempt ${iteration}: ${message}`, { errorCount: verifyResult.errors.length }, Date.now() - t0, iteration));
        },
      });
      files = repairResult.files;
      cb.onFilesReady(files);
      if (repairResult.success) {
        deployReady = true;
        break;
      }
      debugTraceEntries.push(traceEntry("debugger", "error", `Repair loop completed without success`, { attempts: repairResult.attempts, errors: repairResult.errorHistory }, Date.now() - t0, iteration));
      break;
    } catch (err) {
      debugTraceEntries.push(traceEntry("debugger", "error", "", { error: String(err) }, Date.now() - t0, iteration));
      if (iteration === MAX_ITERATIONS) break;
    }
  }

  trace.buildVerifier = buildTraceEntries;
  trace.debugger = debugTraceEntries;
  cb.onPhaseChange("done");
  return { files, plan, trace, deployReady };
}
