import { useCallback } from "react";
import { runAgent, type LogEntry } from "../services/agentService";
import type { ProjectPlan } from "../services/openaiService";
import type { AgentSession } from "./useAgent";
import { runBuildPipeline } from "../services/sandboxService";
import { verifyCode } from "../services/verificationEngine";
import { fixCodeDeepSeek } from "../services/deepseekService";
import { applyPatchProposal, createPatchProposal, type PatchProposal } from "../services/patchWorkflow";
import type { GeneratedFile } from "../services/claudeService";

const MAX_REPAIR_PATCHES = 2;

export type PendingDiff = {
  proposal: PatchProposal;
  summary: string;
  sessionId: string;
  onAccept: (selectedHunkIds?: string[]) => void | Promise<void>;
  onReject: () => void;
};

export type AgentRunnerProps = {
  syncAgentSession: (sessionId: string, data: Partial<AgentSession>) => Promise<void>;
  setPendingDiff: React.Dispatch<React.SetStateAction<PendingDiff | null>>;
  updateAssistantMessage: (sessionId: string, msgId: string, content: string) => void;
  agentSessionsRef: React.MutableRefObject<Record<string, AgentSession>>;
  runningRef: React.MutableRefObject<Set<string>>;
};

const createLog = (type: LogEntry["type"], message: string): LogEntry => ({
  id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  type,
  message,
  timestamp: new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }),
});

const buildRepairPrompt = (proposal: PatchProposal, errors: string[]) =>
  [
    `Patch "${proposal.prompt}" was applied but production verification failed.`,
    "Fix only the issues below and return ALL project files.",
    "Avoid unrelated redesigns, dependency churn, or deleting user work.",
    "",
    "Errors:",
    ...errors.slice(0, 12).map((error) => `- ${error}`),
  ].join("\n");

const summarizeErrors = (errors: string[]) =>
  errors.length === 0
    ? "No concrete error output was returned."
    : errors.slice(0, 5).map((error) => `- ${error}`).join("\n");

export function useAgentRunner({
  syncAgentSession,
  setPendingDiff,
  updateAssistantMessage,
  agentSessionsRef,
  runningRef,
}: AgentRunnerProps) {
  const triggerAgent = useCallback(
    async (sessionId: string, assistantMsgId: string, prompt: string) => {
      if (runningRef.current.has(sessionId)) return;
      runningRef.current.add(sessionId);

      const existingFiles = agentSessionsRef.current[sessionId]?.files ?? [];
      const isModification = existingFiles.length > 0;

      const appendLog = (type: LogEntry["type"], message: string) => {
        const log = createLog(type, message);
        syncAgentSession(sessionId, {
          prompt,
          logs: [...(agentSessionsRef.current[sessionId]?.logs ?? []), log],
          state: agentSessionsRef.current[sessionId]?.state ?? "planning",
        });
      };

      const queuePatchProposal = (proposal: PatchProposal, repairDepth = 0) => {
        setPendingDiff({
          proposal,
          summary: proposal.summary,
          sessionId,
          onAccept: async (selectedHunkIds?: string[]) => {
            await applyVerifyRepair(proposal, repairDepth, selectedHunkIds);
          },
          onReject: () => {
            setPendingDiff(null);
            appendLog("warning", `Patch rejected: ${proposal.summary}`);
            updateAssistantMessage(sessionId, assistantMsgId, "Patch rejected. Your files remain unchanged.");
          },
        });
      };

      const applyVerifyRepair = async (
        proposal: PatchProposal,
        repairDepth: number,
        selectedHunkIds?: string[]
      ): Promise<void> => {
        const currentFiles = agentSessionsRef.current[sessionId]?.files ?? [];
        const result = applyPatchProposal(proposal, currentFiles, { selectedHunkIds });

        if (!result.applied) {
          const conflictList = result.conflicts
            .slice(0, 4)
            .map((conflict) => `- ${conflict.path}: ${conflict.reason}`)
            .join("\n");

          setPendingDiff(null);
          appendLog("error", `Patch conflict: ${result.conflicts.length} file(s) blocked apply`);
          updateAssistantMessage(sessionId, assistantMsgId, `Patch has conflicts and was not applied.\n${conflictList}`);
          return;
        }

        setPendingDiff(null);
        await syncAgentSession(sessionId, { files: result.files, state: "fixing" });
        appendLog("success", `Patch applied: ${proposal.summary}`);
        const changedFileCount = new Set(
          proposal.filePatches
            .filter((filePatch) => filePatch.hunks.some((hunk) => result.appliedHunkIds.includes(hunk.id)))
            .map((filePatch) => filePatch.path)
        ).size;
        updateAssistantMessage(
          sessionId,
          assistantMsgId,
          `Patch applied: **${changedFileCount} file(s)** changed, **${result.appliedHunkIds.length} hunk(s)** accepted. Running production verification...`
        );

        const verification = verifyCode(result.files);
        const verificationErrors = verification.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => `${issue.filePath}: ${issue.message}`);

        let buildErrors: string[];
        try {
          appendLog("running", "Running sandbox build/lint/test pipeline...");
          const buildResult = await runBuildPipeline(result.files);
          buildErrors = buildResult.errors;
          if (buildResult.success && verificationErrors.length === 0) {
            await syncAgentSession(sessionId, { files: result.files, state: "done" });
            appendLog("success", `Production verification passed in ${(buildResult.duration / 1000).toFixed(1)}s`);
            updateAssistantMessage(
              sessionId,
              assistantMsgId,
              `Patch applied and verified: **${changedFileCount} file(s)** changed, **${result.appliedHunkIds.length} hunk(s)** accepted.`
            );
            return;
          }
        } catch (error) {
          buildErrors = [error instanceof Error ? error.message : "Sandbox verification failed"];
        }

        const allErrors = [...verificationErrors, ...buildErrors];
        appendLog("error", `Production verification failed with ${allErrors.length} issue(s).`);

        if (repairDepth >= MAX_REPAIR_PATCHES) {
          await syncAgentSession(sessionId, { files: result.files, state: "error" });
          updateAssistantMessage(
            sessionId,
            assistantMsgId,
            `Patch was applied, but verification still failed after repair attempts.\n${summarizeErrors(allErrors)}`
          );
          return;
        }

        try {
          appendLog("running", "Builder preparing repair patch from verification errors...");
          updateAssistantMessage(
            sessionId,
            assistantMsgId,
            `Verification found issues. Builder is preparing repair patch ${repairDepth + 1}/${MAX_REPAIR_PATCHES}...`
          );

          const fixed = await fixCodeDeepSeek(result.files, buildRepairPrompt(proposal, allErrors));
          const fixedFiles: GeneratedFile[] = fixed.files.length > 0 ? fixed.files : result.files;
          const repairProposal = createPatchProposal(
            `Repair verification issues for: ${proposal.prompt}`,
            result.files,
            fixedFiles
          );

          if (repairProposal.changedFiles.length === 0) {
            await syncAgentSession(sessionId, { files: result.files, state: "error" });
            appendLog("warning", "Builder returned no repair changes.");
            updateAssistantMessage(
              sessionId,
              assistantMsgId,
              `Verification failed and Builder returned no repair changes.\n${summarizeErrors(allErrors)}`
            );
            return;
          }

          await syncAgentSession(sessionId, { files: result.files, state: "done" });
          appendLog("info", `Repair patch ready: ${repairProposal.summary}`);
          updateAssistantMessage(
            sessionId,
            assistantMsgId,
            `Verification found issues. Review the repair patch before applying it.\n${summarizeErrors(allErrors)}`
          );
          queuePatchProposal(repairProposal, repairDepth + 1);
        } catch (error) {
          await syncAgentSession(sessionId, { files: result.files, state: "error" });
          appendLog("error", error instanceof Error ? error.message : "Repair patch generation failed");
          updateAssistantMessage(
            sessionId,
            assistantMsgId,
            `Verification failed and repair patch generation failed.\n${summarizeErrors(allErrors)}`
          );
        }
      };

      try {
        await runAgent(
          prompt,
          {
            onModificationReady: isModification ? (proposal: PatchProposal) => queuePatchProposal(proposal) : undefined,
            onLog: (log) => {
              syncAgentSession(sessionId, {
                prompt,
                logs: [...(agentSessionsRef.current[sessionId]?.logs ?? []), log],
                state: agentSessionsRef.current[sessionId]?.state ?? "planning",
              });
            },
            onStateChange: (state) => {
              syncAgentSession(sessionId, { state });
              const stateMsgFresh: Record<string, string> = {
                planning: "Planning your project...",
                generating: "Generating all project files...",
                fixing: "Fixing errors...",
                done: "",
                error: "Something went wrong. Check Settings > API Keys.",
              };
              const stateMsgModify: Record<string, string> = {
                planning: "Analyzing your request...",
                generating: "Preparing patch proposal...",
                fixing: "Preparing verified patch...",
                done: "",
                error: "Something went wrong. Check Settings > API Keys.",
              };
              const stateMsg = isModification ? stateMsgModify : stateMsgFresh;
              if (stateMsg[state] !== undefined && state !== "done") {
                updateAssistantMessage(sessionId, assistantMsgId, stateMsg[state]);
              }
            },
            onFilesUpdate: (files) => {
              syncAgentSession(sessionId, { files, state: "generating" });
            },
            onPlanReady: (plan) => {
              syncAgentSession(sessionId, { plan, state: "planning" });
              if (!isModification) {
                updateAssistantMessage(
                  sessionId,
                  assistantMsgId,
                  `Plan ready - **${plan.projectName}**\n${plan.files.length} files - ${plan.stack.join(", ")}\n\nGenerating code...`
                );
              }
            },
          },
          isModification ? existingFiles : undefined
        );

        const session = agentSessionsRef.current[sessionId];
        if (session && !isModification) {
          const fileCount = session.files.length;
          updateAssistantMessage(
            sessionId,
            assistantMsgId,
            `**${(session.plan as ProjectPlan)?.projectName ?? "Project"}** is ready.\n${fileCount} files generated. Check the Project panel to view and download.`
          );
        }
      } catch {
        updateAssistantMessage(sessionId, assistantMsgId, "Agent error. Check your API keys in Settings.");
      } finally {
        runningRef.current.delete(sessionId);
      }
    },
    [syncAgentSession, setPendingDiff, updateAssistantMessage, agentSessionsRef, runningRef]
  );

  return { triggerAgent };
}
