// ─────────────────────────────────────────────────────────────
// agentService.ts
// Main orchestrator — connects frontend to planner + coder
// Supports: fresh generation AND modification of existing files
// ─────────────────────────────────────────────────────────────

import { planProjectFallback } from "./openaiService";
import { generateCode } from "./claudeService";
import { runRepairLoop } from "./repairLoop";
import type { RepairLoopResult } from "./repairLoop";
import type { ProjectPlan } from "./openaiService";
import type { GeneratedFile } from "./claudeService";
import { estimateFileTokens, checkTokenLimit } from "./tokenCounter";
import { verifyCode, quickSanityCheck } from "./verificationEngine";
import { setWorkingMemory, recordEpisode, buildMemoryContext } from "../memory/memoryManager";
import { buildProjectContextPack, indexProjectMemory } from "../memory/projectMemoryIndex";
import { runAgentMesh } from "../agents/orchestrator";
import type { AgentTrace } from "../agents/orchestrator";
import { runBuildPipeline } from "./sandboxService";
import { routeModel, classifyComplexity } from "./modelRouter";
import { generateUnitTests } from "./testGenerator";
import { generateDeployFiles, generateDeploySummary, autoDetectTarget } from "./deployService";
import { generateCommitMessage } from "./gitService";
import { BUILDER_MODEL } from "./aiRuntime";
import { createPatchProposal, type PatchProposal } from "./patchWorkflow";

// ── Types ─────────────────────────────────────────────────────

export type LogEntry = {
  id: string;
  type: "info" | "success" | "error" | "warning" | "running";
  message: string;
  timestamp: string;
};

export type AgentState =
  | "idle"
  | "planning"
  | "generating"
  | "fixing"
  | "done"
  | "error";

export type AgentResult = {
  plan: ProjectPlan;
  files: GeneratedFile[];
  logs: LogEntry[];
  state: AgentState;
  trace?: AgentTrace;
};

// Callbacks that fire during execution (to update UI in real time)
export type AgentCallbacks = {
  onLog: (log: LogEntry) => void;
  onStateChange: (state: AgentState) => void;
  onFilesUpdate: (files: GeneratedFile[]) => void;
  onPlanReady: (plan: ProjectPlan) => void;
  onChunk?: (chunk: string) => void;
  onModificationReady?: (proposal: PatchProposal) => void;
};

// ── Helpers ───────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);

const nowTime = () =>
  new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const makeLog = (
  type: LogEntry["type"],
  message: string
): LogEntry => ({
  id: uid(),
  type,
  message,
  timestamp: nowTime(),
});

// ── Check auto-fix preference ─────────────────────────────────
const shouldAutoFix = (): boolean => {
  try {
    const settings = localStorage.getItem("aiagent_settings");
    if (settings) {
      const parsed = JSON.parse(settings);
      return parsed?.prefs?.autoFix ?? true;
    }
  } catch (error) {
    console.warn("Failed to read agent preferences", error);
  }
  return true;
};

// ── Main run function ─────────────────────────────────────────
// Pass existingFiles when user sends a follow-up instruction on an
// already-generated project (upgrade, fix, add feature, etc.)
export const runAgent = async (
  userPrompt: string,
  callbacks: AgentCallbacks,
  existingFiles?: GeneratedFile[]   // ← provided for follow-up messages
): Promise<AgentResult> => {
  const { onLog, onStateChange, onFilesUpdate, onPlanReady } = callbacks;
  const logs: LogEntry[] = [];
  const isModification = existingFiles && existingFiles.length > 0;

  const log = (type: LogEntry["type"], message: string) => {
    const entry = makeLog(type, message);
    logs.push(entry);
    onLog(entry);
    return entry;
  };

  // ══════════════════════════════════════════════════════════
  // MODIFICATION MODE — user is upgrading/fixing existing code
  // ══════════════════════════════════════════════════════════
  if (isModification) {
    // ── Token limit check before sending ───────────────────
    const fileTokens = estimateFileTokens(existingFiles);
    const tokenCheck = checkTokenLimit(fileTokens, BUILDER_MODEL);
    if (tokenCheck.level !== "ok") {
      log("warning", tokenCheck.message);
    }

    // ── Memory context read ──────────────────────────────
    const memoryCtx = buildMemoryContext(userPrompt);
    if (memoryCtx) log("info", "Memory context loaded from past sessions");

    onStateChange("generating");
    log("info", `Instruction received: "${userPrompt.slice(0, 80)}${userPrompt.length > 80 ? "..." : ""}"`);
    log("running", `Analyzing ${existingFiles.length} existing files...`);
    log("running", "Applying your changes...");

    // Build a stub plan (so the result type stays consistent)
    const stubPlan: ProjectPlan = planProjectFallback(userPrompt);

    const projectMemoryPack = await buildProjectContextPack(existingFiles, userPrompt, 5000);
    log(
      "info",
      `Project memory indexed: ${projectMemoryPack.files.length} files, ${projectMemoryPack.relevantChunks.length} relevant context chunks`
    );

    let files: GeneratedFile[];

    try {
      // Pass existing files — AI will MODIFY, not rebuild
      const result = await generateCode("", userPrompt, callbacks.onChunk, existingFiles);
      files = result.files.length > 0 ? result.files : existingFiles;

      if (result.files.length === 0) {
        throw new Error("No files returned. The AI may have misunderstood — try rephrasing.");
      }

      // ── Show diff + request approval (NOT auto-apply) ──
      const proposal = createPatchProposal(userPrompt, existingFiles, files);
      log("info", `Patch proposal ready: ${proposal.summary}`);

      // ── Signal UI: show diff, wait for accept/reject ────
      if (callbacks.onModificationReady) {
        callbacks.onModificationReady(proposal);
        // Return WITHOUT applying — UI will call onFilesUpdate on accept
        return { plan: stubPlan, files: existingFiles, logs, state: "done" };
      }

      // Fallback if no approval callback (backward compat)
      onFilesUpdate(files);
      log("success", `✓ Changes applied — ${files.length} files updated`);
      await indexProjectMemory(files);
      log("info", "Project memory refreshed after modification");

      // ── Verify modified code ───────────────────────────
      const verification = verifyCode(files);
      if (!verification.passed) {
        log("warning", `Verification: ${verification.summary}`);
      } else if (verification.warnings > 0) {
        log("info", `Verification: ${verification.summary}`);
      }

      // ── Build pipeline: install → build → lint → test ───
      try {
        log("running", "Running build verification on modified code...");
        const buildResult = await runBuildPipeline(files);
        if (buildResult.success) {
          log("success", `Build passed in ${(buildResult.duration / 1000).toFixed(1)}s`);
        } else {
          log("error", `Build failed: ${buildResult.errors.length} error(s)`);
          for (const e of buildResult.errors.slice(0, 3)) { log("error", e); }

          // ── Auto-fix from build errors ──────────────────
          if (shouldAutoFix() && buildResult.errors.length > 0) {
            log("warning", "Auto-fix for modification — attempting build repair...");
            onStateChange("fixing");
            const repairResult: RepairLoopResult = await runRepairLoop(files, {
              maxAttempts: 3,
              onChunk: callbacks.onChunk,
              log: (type, message) => log(type, message),
            });
            files = repairResult.files;
            onFilesUpdate(files);
            await indexProjectMemory(files);
            log("info", "Project memory refreshed after repair");
            if (!repairResult.success) {
              log("error", `Repair loop ended after ${repairResult.attempts} attempts and did not reach a successful build.`);
            }
          }
        }
      } catch {
        log("warning", "Build pipeline unavailable for modification verification");
      }

      // ── Record episode in memory ───────────────────────
      recordEpisode({
        sessionTitle: userPrompt.slice(0, 50),
        userPrompt,
        projectName: stubPlan.projectName,
        fileCount: files.length,
        outcome: verification.passed ? "success" : "incomplete",
        summary: `Modified project: ${verification.summary}`,
        keyLearnings: verification.issues.slice(0, 3).map((i) => i.message),
      });
      setWorkingMemory({
        sessionId: uid(),
        userGoal: userPrompt,
        recentActions: ["Applied modifications", `Verified ${files.length} files`],
        activeFiles: files.map((f) => f.path),
        lastContext: projectMemoryPack.contextText.slice(0, 2000),
        updatedAt: Date.now(),
      });

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Modification failed";
      log("error", `Modification failed: ${message}`);
      onStateChange("error");
      return { plan: stubPlan, files: existingFiles, logs, state: "error" };
    }

    onStateChange("done");
    log("success", `✓ "${userPrompt.slice(0, 50)}${userPrompt.length > 50 ? "..." : ""}" applied successfully!`);
    return { plan: stubPlan, files, logs, state: "done" };
  }

  // ══════════════════════════════════════════════════════════
  // FRESH GENERATION MODE — routed through Multi-Agent Mesh
  // ══════════════════════════════════════════════════════════

    // ── STEP 0: Memory context retrieval ──────────────────────
  const memoryContext = buildMemoryContext(userPrompt);
  if (memoryContext) {
    log("info", "Memory context loaded from past sessions");
  }

  // ── STEP 0.5: Model routing ───────────────────────────────
  const complexity = classifyComplexity(userPrompt, false, 0);
  const route = routeModel(userPrompt);
  log("info", `Prompt complexity: ${complexity}`);
  log("info", `Model routed: ${route.model.provider} (${route.reason})`);
  onStateChange("planning");

  // ── STEP 1-5: Multi-Agent Mesh Pipeline ──────────────────
  // Architect → Planner → Executor → Reviewer → Debugger
  try {
    log("info", `Received prompt: "${userPrompt.slice(0, 60)}${userPrompt.length > 60 ? "..." : ""}"`);
    log("running", "Architect analyzing requirements...");

    const meshResult = await runAgentMesh(userPrompt, {
      onPhaseChange: (phase) => {
        // Map mesh phases to agent states
        const phaseMap: Record<string, AgentState> = {
          architecture: "planning",
          planning: "planning",
          execution: "generating",
          review: "generating",
          debug: "fixing",
          done: "done",
          error: "error",
        };
        const state = phaseMap[phase] || "generating";
        onStateChange(state);

        // Log phase transitions
        const phaseLogs: Record<string, string> = {
          architecture: "Architect designing system structure...",
          planning: "Planner creating file blueprint...",
          execution: "Executor generating project code...",
          review: "Reviewer checking code quality...",
          debug: "Debugger applying fixes...",
        };
        if (phaseLogs[phase]) log("running", phaseLogs[phase]);
      },
      onFilesReady: (files) => {
        onFilesUpdate(files);
      },
      onPlanReady: (plan) => {
        onPlanReady(plan);
      },
    });

    let files = meshResult.files;
    const trace = meshResult.trace;

    // Log agent trace entries
    if (trace) {
      for (const role of ["architect", "planner", "executor", "reviewer"] as const) {
        const entry = trace[role];
        if (entry && !Array.isArray(entry)) {
          log("info", `${role}: ${entry.status} (${entry.duration}ms)`);
        }
      }
      // Log build verifier iterations
      if (trace.buildVerifier && Array.isArray(trace.buildVerifier)) {
        for (const entry of trace.buildVerifier) {
          log("info", `buildVerifier #${entry.iteration}: ${entry.status} (${entry.duration}ms)`);
        }
      }
      // Log debugger iterations
      if (trace.debugger && Array.isArray(trace.debugger)) {
        for (const entry of trace.debugger) {
          log("info", `debugger #${entry.iteration}: ${entry.status} (${entry.duration}ms)`);
        }
      }
    }
    const plan = meshResult.plan || planProjectFallback(userPrompt);

    if (files.length === 0) {
      throw new Error("No files returned. Try rephrasing your prompt.");
    }

    let generatedMemoryIndex = await indexProjectMemory(files);
    log("info", `Project memory indexed: ${generatedMemoryIndex.files.length} files, ${generatedMemoryIndex.graphSummary.symbols} symbols`);

    // ── Verify generated code ────────────────────────────
    const verification = verifyCode(files);
    if (!verification.passed) {
      log("warning", `Verification: ${verification.summary}`);
      for (const issue of verification.issues.filter((i) => i.severity === "error")) {
        log("error", `${issue.filePath}: ${issue.message}`);
      }
    } else if (verification.warnings > 0) {
      log("info", `Verification: ${verification.summary}`);
    }
    const sanity = quickSanityCheck(files);
    if (sanity) log("warning", `Sanity check: ${sanity}`);

    // ── Generate unit tests ──────────────────────────────
    const testFiles = generateUnitTests(files);
    if (testFiles.length > 0) {
      log("success", `Generated ${testFiles.length} unit test file(s)`);
      files.push(...testFiles);
    }

    // ── Generate deploy config ───────────────────────────
    const deployFiles = generateDeployFiles(files);
    if (deployFiles.length > 0) {
      log("info", `Generated ${deployFiles.length} deploy config file(s)`);
      files.push(...deployFiles);
      const deployConfig = autoDetectTarget(files);
      log("info", generateDeploySummary(deployConfig, files.length).split('\n')[0]);
    }

    // ── AI-generated commit message ──────────────────────
    const commitMsg = generateCommitMessage([], userPrompt);
    log("info", `Suggested commit: ${commitMsg.split('\n')[0]}`);

    // ── Build pipeline: install → build → lint → test ───
    try {
      log("running", "Running build pipeline (install + build + lint + test)...");
      const buildResult = await runBuildPipeline(files);
      if (buildResult.success) {
        log("success", `Build pipeline passed in ${(buildResult.duration / 1000).toFixed(1)}s`);
      } else {
        log("error", `Build failed with ${buildResult.errors.length} error(s) in ${(buildResult.duration / 1000).toFixed(1)}s`);
        for (const e of buildResult.errors.slice(0, 5)) {
          log("error", e);
        }
        if (buildResult.warnings.length > 0) {
          log("warning", `${buildResult.warnings.length} warning(s)`);
        }

        // ── Auto-fix from build errors ──────────────────
        if (shouldAutoFix() && buildResult.errors.length > 0) {
          log("warning", "Auto-fix enabled — attempting to fix build errors...");
          onStateChange("fixing");
          const repairResult: RepairLoopResult = await runRepairLoop(files, {
            maxAttempts: 3,
            onChunk: callbacks.onChunk,
            log: (type, message) => log(type, message),
          });
          files = repairResult.files;
          onFilesUpdate(files);
          generatedMemoryIndex = await indexProjectMemory(files);
          log("info", "Project memory refreshed after repair");
          if (!repairResult.success) {
            log("error", `Repair loop ended after ${repairResult.attempts} attempts and did not reach a successful build.`);
          }
        }
      }
    } catch {
      log("warning", "Build pipeline unavailable (WebContainer may not be supported in this browser)");
    }

    // ── Record episode + update working memory ────────────
    recordEpisode({
      sessionTitle: userPrompt.slice(0, 50),
      userPrompt,
      projectName: plan.projectName,
      stack: plan.stack,
      fileCount: files.length,
      outcome: verification.passed ? "success" : "incomplete",
      summary: `Multi-agent generated ${files.length} files. ${verification.summary}`,
      keyLearnings: verification.issues.slice(0, 3).map((i) => i.message),
    });
    setWorkingMemory({
      sessionId: uid(),
      userGoal: userPrompt,
      recentActions: ["Architect designed structure", "Planner created blueprint", "Executor generated code", "Reviewer validated output", `Verified ${files.length} files`],
      activeFiles: files.map((f) => f.path),
      lastContext: JSON.stringify({
        plan,
        memoryFingerprint: generatedMemoryIndex.fingerprint,
        symbols: generatedMemoryIndex.graphSummary.symbols,
        entryFiles: generatedMemoryIndex.graphSummary.entryFiles,
      }),
      updatedAt: Date.now(),
    });

    onStateChange("done");
    log("success", `✓ Project "${plan.projectName}" ready! ${files.length} files generated via multi-agent pipeline.`);

    return { plan, files, logs, state: "done", trace };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Agent mesh failed";
    log("error", `Agent mesh failed: ${message}`);
    onStateChange("error");
    return { plan: planProjectFallback(userPrompt), files: [], logs, state: "error" };
  }
};
