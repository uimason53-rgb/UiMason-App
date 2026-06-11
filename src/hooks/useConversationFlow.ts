// ─────────────────────────────────────────────────────────────
// useConversationFlow.ts
// Smart chat routing: workspace analysis → agent execution → AI chat.
// Extracted from App.tsx triggerConversation callback.
// ─────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { chatWithBrain } from "../services/openaiService";
import { askCodebase } from "../search/codebaseQA";
import { generateWorkspaceResponse, buildWorkspaceContext, flattenWorkspaceFiles, workspaceToGeneratedFiles } from "../utils/workspaceAnalysis";
import type { ChatMessage, Workspace } from "../types/chat";
import type { AgentSession } from "./useAgent";

import { isWorkspaceCommand, isClearBuildRequest, buildContextFromMessages } from "../utils/intentDetection";

export type ConversationFlowProps = {
  updateAssistantMessage: (sessionId: string, msgId: string, content: string) => void;
  triggerAgent: (sessionId: string, assistantMsgId: string, prompt: string) => void;
  workspaceRef: React.MutableRefObject<Workspace | null>;
  agentSessionsRef: React.MutableRefObject<Record<string, AgentSession>>;
  runningRef: React.MutableRefObject<Set<string>>;
};

export function useConversationFlow({
  updateAssistantMessage,
  triggerAgent,
  workspaceRef,
  agentSessionsRef,
  runningRef,
}: ConversationFlowProps) {
  const triggerConversation = useCallback(
    async (sessionId: string, assistantMsgId: string, currentMessages: ChatMessage[]) => {
      if (runningRef.current.has(sessionId)) return;
      runningRef.current.add(sessionId);

      try {
        const activeWs = workspaceRef.current;
        const userMessages = currentMessages.filter((m) => m.role === "user");
        const isFirstMessage = userMessages.length === 1;
        const latestUserMsg = userMessages[userMessages.length - 1]?.content ?? "";

        // ── PATH 1: Workspace command → Codebase QA / local response ────
        if (activeWs && isWorkspaceCommand(latestUserMsg)) {
          const agentSession = agentSessionsRef.current[sessionId];
          const existingFiles = agentSession?.files ?? [];
          const workspaceFiles = workspaceToGeneratedFiles(activeWs);

          if (existingFiles.length > 0) {
            const qaResult = await askCodebase(existingFiles, latestUserMsg);
            if (qaResult.confidence > 0) {
              updateAssistantMessage(sessionId, assistantMsgId, qaResult.answer);
              runningRef.current.delete(sessionId);
              return;
            }
          }

          if (workspaceFiles.length > 0) {
            const qaResult = await askCodebase(workspaceFiles, latestUserMsg);
            if (qaResult.confidence > 0) {
              updateAssistantMessage(sessionId, assistantMsgId, qaResult.answer);
              runningRef.current.delete(sessionId);
              return;
            }
          }

          const response = generateWorkspaceResponse(latestUserMsg, activeWs);
          updateAssistantMessage(sessionId, assistantMsgId, response);
          runningRef.current.delete(sessionId);
          return;
        }

        // ── PATH 2: Clear build prompt → skip Brain chat, generate now ─────
        if (isFirstMessage && isClearBuildRequest(latestUserMsg)) {
          updateAssistantMessage(sessionId, assistantMsgId, "Planning your project...");
          runningRef.current.delete(sessionId);
          const prompt = activeWs
            ? `${buildWorkspaceContext(activeWs)}\n\nUser request: ${latestUserMsg}`
            : latestUserMsg;
          triggerAgent(sessionId, assistantMsgId, prompt);
          return;
        }

        // ── PATH 3: Call GPT-5.5 Brain (with workspace context injected) ───
        const skipPhrases = ["Thinking...", "Planning your", "Starting generation", "Got it!", "I've analyzed"];
        let chatHistory = currentMessages
          .filter((m) => {
            if (m.role === "user") return m.content.trim().length > 0;
            return !skipPhrases.some((p) => m.content.startsWith(p));
          })
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        if (activeWs && chatHistory.length > 0) {
          const wsCtx = buildWorkspaceContext(activeWs);
          chatHistory = [
            { role: "user" as const, content: wsCtx },
            { role: "assistant" as const, content: `Understood. I have full awareness of the workspace **${activeWs.name}** and its ${flattenWorkspaceFiles(activeWs.tree).length} files. I'll respond accordingly.` },
            ...chatHistory,
          ];
        }

        // Stream tokens progressively to the assistant message
        let streamedContent = "";
        const result = await chatWithBrain(chatHistory, (chunk: string) => {
          streamedContent += chunk;
          updateAssistantMessage(sessionId, assistantMsgId, streamedContent);
        });

        if (result.shouldGenerate) {
          const contextPrompt = activeWs
            ? `${buildWorkspaceContext(activeWs)}\n\n${buildContextFromMessages(currentMessages)}`
            : buildContextFromMessages(currentMessages);
          const genMsg = result.message || "Starting generation now...";
          updateAssistantMessage(sessionId, assistantMsgId, `${genMsg}\n\nPlanning your project...`);
          runningRef.current.delete(sessionId);
          triggerAgent(sessionId, assistantMsgId, contextPrompt);
        } else {
          updateAssistantMessage(sessionId, assistantMsgId, result.message);
          runningRef.current.delete(sessionId);
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Something went wrong. Please check your OpenAI Brain and DeepSeek Builder API keys in Settings.";
        updateAssistantMessage(sessionId, assistantMsgId, msg);
        runningRef.current.delete(sessionId);
      }
    },
    [updateAssistantMessage, triggerAgent, workspaceRef, agentSessionsRef, runningRef]
  );

  return { triggerConversation };
}
