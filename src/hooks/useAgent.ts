// ─────────────────────────────────────────────────────────────
// useAgent.ts
// React hook that connects agentService to your UI
// Use this in App.tsx instead of calling agentService directly
// ─────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { runAgent } from "../services/agentService";
import type { AgentState, LogEntry } from "../services/agentService";
import type { GeneratedFile } from "../services/claudeService";
import type { ProjectPlan } from "../services/openaiService";

export type AgentSession = {
  prompt: string;
  plan: ProjectPlan | null;
  files: GeneratedFile[];
  logs: LogEntry[];
  state: AgentState;
};

export function useAgent() {
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // ── Start agent with a prompt ──────────────────────────────
  const startAgent = useCallback(async (prompt: string) => {
    if (isRunning) return;
    setIsRunning(true);

    // Init session
    const initialSession: AgentSession = {
      prompt,
      plan: null,
      files: [],
      logs: [],
      state: "planning",
    };
    setAgentSession(initialSession);

    try {
      await runAgent(prompt, {
        // New log entry received
        onLog: (log: LogEntry) => {
          setAgentSession((prev) =>
            prev ? { ...prev, logs: [...prev.logs, log] } : prev
          );
        },

        // State changed (planning → generating → done)
        onStateChange: (state: AgentState) => {
          setAgentSession((prev) =>
            prev ? { ...prev, state } : prev
          );
        },

        // Files updated (as they come in)
        onFilesUpdate: (files: GeneratedFile[]) => {
          setAgentSession((prev) =>
            prev ? { ...prev, files } : prev
          );
        },

        // Plan is ready
        onPlanReady: (plan: ProjectPlan) => {
          setAgentSession((prev) =>
            prev ? { ...prev, plan } : prev
          );
        },
      });
    } catch (err) {
      console.error("Agent error:", err);
      setAgentSession((prev) =>
        prev
          ? {
              ...prev,
              state: "error",
              logs: [
                ...prev.logs,
                {
                  id: Math.random().toString(36).slice(2),
                  type: "error" as const,
                  message: err instanceof Error ? err.message : "Unknown error",
                  timestamp: new Date().toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }),
                },
              ],
            }
          : prev
      );
    } finally {
      setIsRunning(false);
    }
  }, [isRunning]);

  // ── Reset agent session ────────────────────────────────────
  const resetAgent = useCallback(() => {
    setAgentSession(null);
    setIsRunning(false);
  }, []);

  return {
    agentSession,
    isRunning,
    startAgent,
    resetAgent,
  };
}