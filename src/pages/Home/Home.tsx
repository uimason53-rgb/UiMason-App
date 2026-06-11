import { useState, type MutableRefObject } from "react";
import Hero from "../../components/hero/Hero";
import PromptBox from "../../components/prompt/PromptBox";
import ChatScreen from "../../components/chat/ChatScreen";
import Project from "../Project/Project";
import type { ChatAttachment, ChatSession, Workspace } from "../../types/chat";
import type { AgentSession } from "../../hooks/useAgent";
import type { PendingDiff } from "../../hooks/useAgentRunner";
import type { GeneratedFile } from "../../services/claudeService";

import type { StreamingState } from "../../hooks/useStreaming";

type HomeProps = {
  activeSession: ChatSession | null;
  activeAgentSession: AgentSession | null;
  workspace: Workspace | null;
  onCreateProject: (prompt: string, attachments?: ChatAttachment[]) => void;
  onSendMessage: (message: string, attachments?: ChatAttachment[]) => void;
  onUpdateFiles?: (files: GeneratedFile[]) => void;
  inputFocusRef: MutableRefObject<(() => void) | null>;
  streaming?: StreamingState;
  pendingDiff?: PendingDiff | null;
};

export default function Home({
  activeSession,
  activeAgentSession,
  workspace,
  onCreateProject,
  onSendMessage,
  onUpdateFiles,
  inputFocusRef,
  streaming,
  pendingDiff,
}: HomeProps) {
  const [panelOpen, setPanelOpen] = useState(true);

  const isGenerating =
    activeAgentSession?.state === "generating" ||
    activeAgentSession?.state === "planning" ||
    activeAgentSession?.state === "fixing";

  // ── Landing page (no active session) ──────────────────────
  if (!activeSession) {
    return (
      <div className="home-page">
        <Hero />
        <PromptBox onGenerate={onCreateProject} workspace={workspace} />
      </div>
    );
  }

  // ── Split layout (active session) ──────────────────────────
  return (
    <div className="split-layout">
      {/* ── LEFT: Chat ───────────────────────────────────── */}
      <div className={`split-chat${panelOpen ? "" : " split-chat--full"}`}>
        <ChatScreen
          key={activeSession.id}
          session={activeSession}
          workspace={workspace}
          onSendMessage={onSendMessage}
          inputFocusRef={inputFocusRef}
          streaming={streaming}
          pendingDiff={pendingDiff}
        />
      </div>

      {/* ── DIVIDER + TOGGLE ─────────────────────────────── */}
      <div className="split-divider">
        <button
          className="split-toggle"
          onClick={() => setPanelOpen((v) => !v)}
          title={panelOpen ? "Hide project panel" : "Show project panel"}
        >
          {panelOpen ? (
            /* chevron right = close panel */
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            /* chevron left = open panel */
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>

      {/* ── RIGHT: Project panel ─────────────────────────── */}
      {panelOpen && (
        <div className="split-project">
          {activeAgentSession ? (
            <Project
              projectName={activeAgentSession.plan?.projectName ?? "project"}
              files={activeAgentSession.files}
              logs={activeAgentSession.logs}
              isGenerating={isGenerating}
              onFilesChange={onUpdateFiles}
            />
          ) : (
            <div className="split-project-empty">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none" opacity="0.1">
                <path d="M6 9C6 7.34 7.34 6 9 6H19L24 11H37C38.66 11 40 12.34 40 14V36C40 37.66 38.66 39 37 39H9C7.34 39 6 37.66 6 36V9Z" stroke="currentColor" strokeWidth="1.8"/>
              </svg>
              <span className="split-project-empty__title">No project yet</span>
              <span className="split-project-empty__hint">
                Send a prompt in chat to generate code
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
