// ─────────────────────────────────────────────────────────────
// streamingService.ts
// Real-time token-by-token streaming + progress events
// Supports live onChunk callbacks for progressive UI updates
// ─────────────────────────────────────────────────────────────

import { getAuthToken } from "../hooks/useSessionManager";

export type StreamEvent = {
  type: "token" | "tool_call" | "tool_result" | "phase" | "build_log" | "error" | "done";
  data: string;
  timestamp: number;
};

export type StreamCallbacks = {
  onToken: (token: string) => void;
  onPhase: (phase: string) => void;
  onToolCall: (name: string) => void;
  onToolResult: (success: boolean) => void;
  onBuildLog: (line: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
};

let listeners: Partial<StreamCallbacks> = {};

export const onStream = (cb: Partial<StreamCallbacks>) => {
  listeners = { ...listeners, ...cb };
};

export const offStream = () => {
  listeners = {};
};

export const emitToken = (token: string) => listeners.onToken?.(token);
export const emitPhase = (phase: string) => listeners.onPhase?.(phase);
export const emitToolCall = (name: string) => listeners.onToolCall?.(name);
export const emitToolResult = (success: boolean) => listeners.onToolResult?.(success);
export const emitBuildLog = (line: string) => listeners.onBuildLog?.(line);
export const emitError = (error: string) => listeners.onError?.(error);
export const emitDone = () => listeners.onDone?.();

export const emitStreamEvent = (event: StreamEvent) => {
  switch (event.type) {
    case "token": emitToken(event.data); break;
    case "tool_call": emitToolCall(event.data); break;
    case "tool_result": emitToolResult(event.data === "true"); break;
    case "phase": emitPhase(event.data); break;
    case "build_log": emitBuildLog(event.data); break;
    case "error": emitError(event.data); break;
    case "done": emitDone(); break;
  }
};

// ── TokenStreamer — batches tokens to prevent re-render storms ──
export class TokenStreamer {
  private buffer = "";
  private lastFlush = 0;
  private static batchMs = 30; // Flush at most every 30ms (33fps)
  private static maxBatchChars = 120; // Max chars before forced flush
  private onChunk: ((text: string) => void) | null;

  constructor(onChunk?: (text: string) => void) {
    this.onChunk = onChunk || null;
  }

  feed(chunk: string) {
    this.buffer += chunk;
    const now = Date.now();
    if (now - this.lastFlush > TokenStreamer.batchMs || this.buffer.length > TokenStreamer.maxBatchChars) {
      this.flush();
    }
  }

  flush() {
    if (this.buffer.length > 0) {
      if (this.onChunk) {
        this.onChunk(this.buffer);
      }
      emitToken(this.buffer);
      this.buffer = "";
    }
    this.lastFlush = Date.now();
  }
}

// ── SSE Stream Reader with live onChunk support ───────────────
type SSEAccumulator = {
  content: string;
  tool_calls: unknown[];
  finishReason: string;
};

export const readSSEStream = async (
  url: string,
  body: Record<string, unknown>,
  onChunk?: (text: string) => void,
): Promise<{ message?: { content: string; tool_calls?: unknown[] }; finishReason?: string }> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    let parsedMessage: string | undefined;
    try {
      const parsed = JSON.parse(errText);
      parsedMessage = parsed?.error?.message || parsed?.error || parsed?.message;
    } catch {
      parsedMessage = undefined;
    }
    throw new Error(parsedMessage || errText || `API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body reader available");

  const decoder = new TextDecoder();
  const accumulator: SSEAccumulator = { content: "", tool_calls: [], finishReason: "" };
  const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
  const streamer = new TokenStreamer(onChunk);

  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") break;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          const finish = parsed.choices?.[0]?.finish_reason;

          if (delta?.content) {
            accumulator.content += delta.content;
            streamer.feed(delta.content);
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsMap.has(idx)) {
                toolCallsMap.set(idx, { id: tc.id || `tc-${idx}`, name: "", args: "" });
              }
              const entry = toolCallsMap.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name += tc.function.name;
              if (tc.function?.arguments) entry.args += tc.function.arguments;
            }
          }

          if (finish) accumulator.finishReason = finish;
        } catch (error) {
          console.warn("Failed to parse SSE event", error);
        }
      }
    }
  } finally {
    streamer.flush();
  }

  const toolCalls = [...toolCallsMap.values()].map((tc) => ({
    id: tc.id,
    type: "function" as const,
    function: {
      name: tc.name,
      arguments: tc.args,
    },
  }));

  return {
    message: {
      content: accumulator.content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    finishReason: accumulator.finishReason || "stop",
  };
};
