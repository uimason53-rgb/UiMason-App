import { useCallback, useState } from "react";
import { createId } from "../utils/helpers";
import { buildWorkspaceTree } from "../utils/workspaceAnalysis";
import { getAuthToken, setAuthToken } from "./useSessionManager";
import type { Workspace } from "../types/chat";
import type { useSessionManager } from "./useSessionManager";

type SessionManager = ReturnType<typeof useSessionManager>;

type UseAppControllerOptions = {
  sessions: SessionManager;
};

export const useAppController = ({ sessions }: UseAppControllerOptions) => {
  const [appError, setAppError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const clearAppError = useCallback(() => {
    setAppError(null);
  }, []);

  const clearStatusMessage = useCallback(() => {
    setStatusMessage(null);
  }, []);

  const setTransientStatus = useCallback((message: string) => {
    setStatusMessage(message);
    window.setTimeout(() => {
      setStatusMessage((current) => (current === message ? null : current));
    }, 5000);
  }, []);

  const initializeAuth = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/token", { method: "POST" });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        setAppError(
          `Authentication failed: ${errorBody?.error || response.statusText || response.status}`
        );
        return false;
      }
      const data = await response.json();
      setAuthToken(data.token, data.refreshToken);
      setTransientStatus("Authenticated successfully");
      return true;
    } catch (error) {
      setAppError("Unable to reach backend auth service. Some features may be unavailable.");
      console.warn("Auth initialization failed", error);
      return false;
    }
  }, [setTransientStatus]);

  const handleWorkspaceUpload = useCallback(
    async (files: FileList) => {
      if (files.length === 0) {
        setAppError("No files selected for upload.");
        return;
      }

      setStatusMessage("Preparing workspace upload...");
      try {
        const { name, tree } = await buildWorkspaceTree(files);
        const workspace: Workspace = { id: createId(), name, tree, createdAt: Date.now() };

        if (sessions.activeSessionId) {
          sessions.updateSessionWorkspace(sessions.activeSessionId, workspace);
        } else {
          sessions.createSession(undefined, undefined, workspace);
        }

        const response = await fetch("/api/workspaces", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getAuthToken()}`,
          },
          body: JSON.stringify(workspace),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          throw new Error(errorBody?.error || response.statusText || "Unable to save workspace");
        }

        setTransientStatus("Workspace uploaded successfully.");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Workspace upload failed. Please try again.";
        setAppError(message);
        console.error("Workspace upload error", error);
      }
    },
    [sessions, setTransientStatus]
  );

  const handleClearWorkspace = useCallback(async () => {
    if (!sessions.activeSessionId) {
      setAppError("No active session selected to clear workspace.");
      return;
    }

    const workspace = sessions.activeSession?.workspace;
    if (!workspace) {
      setAppError("There is no workspace attached to the active session.");
      return;
    }

    setStatusMessage("Clearing workspace...");
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || response.statusText || "Unable to clear workspace");
      }

      sessions.updateSessionWorkspace(sessions.activeSessionId, null);
      setTransientStatus("Workspace cleared successfully.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Workspace deletion failed. Please try again.";
      setAppError(message);
      console.error("Workspace clear error", error);
    }
  }, [sessions, setTransientStatus]);

  return {
    appError,
    statusMessage,
    clearAppError,
    clearStatusMessage,
    initializeAuth,
    handleWorkspaceUpload,
    handleClearWorkspace,
  };
};
