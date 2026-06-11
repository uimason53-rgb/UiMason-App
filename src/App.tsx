import { useState, useRef, useEffect } from "react";
import AppLayout from "./layouts/AppLayout";
import Home from "./pages/Home/Home";
import Settings from "./pages/Settings/Settings";
import type { GeneratedFile } from "./services/claudeService";
import BackgroundGlow from "./components/ui/BackgroundGlow";
import AppStatusBanner from "./components/ui/AppStatusBanner";
import ProfileSetupModal from "./components/modals/ProfileSetupModal";
import { useProfile } from "./hooks/useProfile";
import { useStreaming } from "./hooks/useStreaming";
import { useSessionManager } from "./hooks/useSessionManager";
import { useAppController } from "./hooks/useAppController";
import { useAgentRunner } from "./hooks/useAgentRunner";
import type { PendingDiff } from "./hooks/useAgentRunner";
import { useConversationFlow } from "./hooks/useConversationFlow";
import type { Workspace, UserProfile } from "./types/chat";
import type { AgentSession } from "./hooks/useAgent";

export default function App() {
  const sessions = useSessionManager();
  const appController = useAppController({ sessions });

  // ── Auth bootstrap ────────────────────────────────────────
  const { initializeAuth } = appController;

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // ── UI state ───────────────────────────────────────────────
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<PendingDiff | null>(null);

  // ── Profile ────────────────────────────────────────────────
  const { profile, loaded, saveProfile, deleteProfile } = useProfile();
  const streaming = useStreaming();
  const inputFocusRef = useRef<(() => void) | null>(null);

  // ── Refs for stale-closure-free access ─────────────────────
  const runningRef = useRef<Set<string>>(new Set());
  const agentSessionsRef = useRef<Record<string, AgentSession>>({});

  useEffect(() => {
    agentSessionsRef.current = sessions.agentSessions;
  }, [sessions.agentSessions]);

  // ── Derive active workspace from active session ──────────────
  const activeWorkspace = sessions.activeSession?.workspace ?? null;

  // ── Agent runner ───────────────────────────────────────────
  const { triggerAgent } = useAgentRunner({
    syncAgentSession: sessions.syncAgentSession,
    setPendingDiff,
    updateAssistantMessage: sessions.updateAssistantMessage,
    agentSessionsRef,
    runningRef,
  });

  const workspaceRef = useRef<Workspace | null>(null);
  useEffect(() => {
    workspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  // ── Conversation routing ───────────────────────────────────
  const { triggerConversation } = useConversationFlow({
    updateAssistantMessage: sessions.updateAssistantMessage,
    triggerAgent,
    workspaceRef,
    agentSessionsRef,
    runningRef,
  });

  // ── Create new session + start conversation ────────────────
  const handleNewSession = (firstMessage?: string, attachments?: Parameters<typeof sessions.createSession>[1]) => {
    setShowSettings(false);
    const result = sessions.createSession(firstMessage, attachments);
    setTimeout(() => inputFocusRef.current?.(), 50);
    if (result.hasUserMessage) {
      const msgs = result.session.messages;
      triggerConversation(result.session.id, result.assistantMsgId, msgs);
    }
  };

  // ── Send message to active session ─────────────────────────
  const handleSendMessage = (content: string, attachments?: Parameters<typeof sessions.createSession>[1]) => {
    const sid = sessions.activeSessionId;
    if (!sid) return;

    const hasExistingFiles = (agentSessionsRef.current[sid]?.files ?? []).length > 0;
    const sendResult = sessions.sendMessage(sid, content, attachments, hasExistingFiles);
    if (!sendResult || !content) return;

    if (hasExistingFiles) {
      triggerAgent(sid, sendResult.assistantMsgId, content);
    } else {
      const currentMsgs = sessions.sessions.find((s) => s.id === sid)?.messages ?? [];
      const updatedMessages = [
        ...currentMsgs,
        sendResult.userMsg,
        { id: sendResult.assistantMsgId, role: "assistant" as const, content: hasExistingFiles ? "Got it! Applying your changes..." : "Thinking..." },
      ];
      triggerConversation(sid, sendResult.assistantMsgId, updatedMessages);
    }
  };

  // ── Workspace — tied to active session ────────────────────
  const handleWorkspaceUpload = appController.handleWorkspaceUpload;
  const handleClearWorkspace = appController.handleClearWorkspace;

  // ── Profile ────────────────────────────────────────────────
  const handleSaveProfile = (data: UserProfile) => {
    saveProfile(data);
    setShowProfileModal(false);
  };

  const handleUpdateFiles = (files: GeneratedFile[]) => {
    const sid = sessions.activeSessionId;
    if (!sid) return;
    sessions.syncAgentSession(sid, { files });
  };

  const shouldShowSetup = loaded && !profile && !showProfileModal;

  return (
    <>
      <BackgroundGlow />

      {appController.appError && (
        <AppStatusBanner
          message={appController.appError}
          variant="error"
          onClose={appController.clearAppError}
        />
      )}

      {appController.statusMessage && !appController.appError && (
        <AppStatusBanner message={appController.statusMessage} variant="info" onClose={appController.clearStatusMessage} />
      )}

      {(shouldShowSetup || showProfileModal) && (
        <ProfileSetupModal
          onSave={handleSaveProfile}
          onClose={profile ? () => setShowProfileModal(false) : undefined}
          existingProfile={profile}
        />
      )}

      <AppLayout
        sessions={sessions.sessions}
        activeSessionId={sessions.activeSessionId}
        profile={profile}
        workspace={activeWorkspace}
        onNewProject={() => handleNewSession()}
        onSelectSession={(id) => {
          setShowSettings(false);
          sessions.setActiveSessionId(id);
          setTimeout(() => inputFocusRef.current?.(), 50);
        }}
        onRenameSession={sessions.renameSession}
        onDeleteSession={sessions.deleteSession}
        onWorkspaceUpload={handleWorkspaceUpload}
        onClearWorkspace={handleClearWorkspace}
        onEditProfile={() => setShowProfileModal(true)}
        onDeleteProfile={() => deleteProfile()}
        onOpenSettings={() => setShowSettings((v) => !v)}
      >
        {showSettings ? (
          <Settings onBack={() => setShowSettings(false)} />
        ) : (
          <Home
            activeSession={sessions.activeSession}
            activeAgentSession={sessions.activeAgentSession}
            workspace={activeWorkspace}
            onCreateProject={handleNewSession}
            onSendMessage={handleSendMessage}
            onUpdateFiles={handleUpdateFiles}
            inputFocusRef={inputFocusRef}
            streaming={streaming}
            pendingDiff={pendingDiff}
          />
        )}
      </AppLayout>
    </>
  );
}