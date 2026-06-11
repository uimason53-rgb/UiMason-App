// ─────────────────────────────────────────────────────────────
// useStreaming.ts
// React hook — bridges streamingService events to UI state
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { onStream, offStream } from "../services/streamingService";

export type StreamingState = {
  tokens: string[];
  currentPhase: string;
  toolCalls: string[];
  buildLogs: string[];
  isStreaming: boolean;
  lastError: string | null;
};

export function useStreaming() {
  const [state, setState] = useState<StreamingState>({
    tokens: [],
    currentPhase: "idle",
    toolCalls: [],
    buildLogs: [],
    isStreaming: false,
    lastError: null,
  });

  const reset = () => setState({ tokens: [], currentPhase: "idle", toolCalls: [], buildLogs: [], isStreaming: false, lastError: null });

  useEffect(() => {
    onStream({
      onToken: (token) => setState(s => ({ ...s, tokens: [...s.tokens, token], isStreaming: true })),
      onPhase: (phase) => setState(s => ({ ...s, currentPhase: phase, isStreaming: true })),
      onToolCall: (name) => setState(s => ({ ...s, toolCalls: [...s.toolCalls, `Calling: ${name}...`], isStreaming: true })),
      onToolResult: (ok) => setState(s => ({ ...s, toolCalls: [...s.toolCalls, ok ? "✓ Tool OK" : "✗ Tool failed"], isStreaming: true })),
      onBuildLog: (line) => setState(s => ({ ...s, buildLogs: [...s.buildLogs, line], isStreaming: true })),
      onError: (err) => setState(s => ({ ...s, lastError: err, isStreaming: false })),
      onDone: () => setState(s => ({ ...s, isStreaming: false })),
    });
    return () => offStream();
  }, []);

  return { ...state, reset };
}