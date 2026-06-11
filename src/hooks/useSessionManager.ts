// ─────────────────────────────────────────────────────────────
// useSessionManager.ts
// Manages ChatSession CRUD via backend API (replaces localStorage)
// Backend is the single source of truth.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import type { ChatSession, ChatAttachment, Workspace } from "../types/chat";
import type { AgentSession } from "./useAgent";
import { createId, createTitle } from "../utils/helpers";

const ACTIVE_SESSION_KEY = "uimason_active_session";

// ── API helpers ───────────────────────────────────────────────
let authToken = "";
let refreshToken = "";

export const setAuthToken = (token: string, refresh?: string) => {
  authToken = token;
  if (refresh) refreshToken = refresh;
};

export const getAuthToken = (): string => authToken;


const apiHeaders = () => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };
  if (refreshToken) {
    headers["X-Refresh-Token"] = refreshToken;
  }
  return headers;
};

// Wrapped fetch with auto-refresh on 401
// ── Hook ──────────────────────────────────────────────────────
export function useSessionManager() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_SESSION_KEY)
  );
  const [agentSessions, setAgentSessions] = useState<Record<string, AgentSession>>({});

  // ── Hydrate sessions from backend on mount ─────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sessions", { headers: apiHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setSessions(data);
        }
      } catch (error) {
        console.warn("Failed to load sessions", error);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Persist activeSessionId (lightweight localStorage) ─────
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  }, [activeSessionId]);

  // ── Hydrate agent session on activeSession change ──────────
  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent-sessions/${activeSessionId}`, { headers: apiHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data) {
            setAgentSessions((prev) => ({ ...prev, [activeSessionId]: data }));
          }
        }
      } catch (error) {
      console.warn("Failed to load agent session", error);
    }
    })();
    return () => { cancelled = true; };
  }, [activeSessionId]);

  // ── Sync agent session to backend ─────────────────────────
  const syncAgentSession = useCallback(
    async (sessionId: string, data: Partial<AgentSession>) => {
      setAgentSessions((prev) => ({
        ...prev,
        [sessionId]: { ...(prev[sessionId] ?? { prompt: "", plan: null, files: [], logs: [], state: "idle" }), ...data },
      }));
      fetch(`/api/agent-sessions/${sessionId}`, {
        method: "PUT",
        headers: apiHeaders(),
        body: JSON.stringify(data),
      }).catch(() => {});
    },
    []
  );

  // ── Session CRUD ────────────────────────────────────────────
  const createSession = useCallback(
    (firstMessage?: string, attachments?: ChatAttachment[], workspace?: Workspace) => {
      const userMessage = firstMessage?.trim();
      const assistantMsgId = createId();
      const userMsg =
        userMessage || attachments?.length
          ? {
              id: createId(),
              role: "user" as const,
              content: userMessage ?? "",
              ...(attachments?.length ? { attachments } : {}),
            }
          : null;

      const messages = userMsg
        ? [userMsg, { id: assistantMsgId, role: "assistant" as const, content: "Thinking..." }]
        : [];

      const session: ChatSession = {
        id: createId(),
        title: createTitle(userMessage ?? "New Chat"),
        messages,
        createdAt: Date.now(),
        ...(workspace ? { workspace, workspaceId: workspace.id } : {}),
      };

      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);

      // Persist to backend
      fetch("/api/sessions", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ ...session, messages }),
      }).catch(() => {});

      return { session, assistantMsgId, hasUserMessage: !!userMessage };
    },
    []
  );

  // ── Update workspace for a specific session ────────────────
  const updateSessionWorkspace = useCallback(
    (sessionId: string, workspace: Workspace | null) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const updated = workspace
            ? { ...s, workspace, workspaceId: workspace.id }
            : { ...s, workspace: undefined, workspaceId: undefined };
          // Sync to backend
          fetch(`/api/sessions/${sessionId}`, {
            method: "PUT",
            headers: apiHeaders(),
            body: JSON.stringify({ workspace: workspace ?? null, workspaceId: workspace?.id ?? null }),
          }).catch(() => {});
          return updated;
        })
      );
    },
    []
  );

  const sendMessage = useCallback(
    (sessionId: string, content: string, attachments?: ChatAttachment[], hasExistingFiles?: boolean) => {
      const message = content.trim();
      if (!message && (!attachments || attachments.length === 0)) return null;

      const assistantMsgId = createId();
      const userMsg = {
        id: createId(),
        role: "user" as const,
        content: message,
        ...(attachments?.length ? { attachments } : {}),
      };

      const initialAssistantText = hasExistingFiles
        ? "Got it! Applying your changes..."
        : "Thinking...";

      let updatedMessages: ChatSession["messages"];

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          updatedMessages = [
            ...s.messages,
            userMsg,
            { id: assistantMsgId, role: "assistant" as const, content: initialAssistantText },
          ];
          return {
            ...s,
            title: s.messages.length === 0 ? createTitle(message) : s.title,
            messages: updatedMessages,
          };
        })
      );

      // Sync to backend after state update
      setTimeout(() => {
        setSessions((prev) => {
          const s = prev.find((x) => x.id === sessionId);
          if (s) {
            fetch(`/api/sessions/${sessionId}`, {
              method: "PUT",
              headers: apiHeaders(),
              body: JSON.stringify({ messages: s.messages, title: s.title }),
            }).catch(() => {});
          }
          return prev;
        });
      }, 0);

      return { assistantMsgId, userMsg };
    },
    []
  );

  const updateAssistantMessage = useCallback(
    (sessionId: string, msgId: string, content: string) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const newMsgs = s.messages.map((m) =>
            m.id === msgId ? { ...m, content } : m
          );
          fetch(`/api/sessions/${sessionId}`, {
            method: "PUT",
            headers: apiHeaders(),
            body: JSON.stringify({ messages: newMsgs }),
          }).catch(() => {});
          return { ...s, messages: newMsgs };
        })
      );
    },
    []
  );

  const renameSession = useCallback((sessionId: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
    );
    fetch(`/api/sessions/${sessionId}`, {
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, []);

  const deleteSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setAgentSessions((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      setActiveSessionId((prev) => (prev === sessionId ? null : prev));

      fetch(`/api/sessions/${sessionId}`, { method: "DELETE", headers: apiHeaders() }).catch(() => {});
      fetch(`/api/agent-sessions/${sessionId}`, { method: "DELETE", headers: apiHeaders() }).catch(() => {});
    },
    []
  );

  // ── Derived ─────────────────────────────────────────────────
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeAgentSession = activeSessionId ? agentSessions[activeSessionId] ?? null : null;

  return {
    sessions,
    loaded,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    activeAgentSession,
    agentSessions,
    setAgentSessions,
    syncAgentSession,
    createSession,
    updateSessionWorkspace,
    sendMessage,
    updateAssistantMessage,
    renameSession,
    deleteSession,
  };
}