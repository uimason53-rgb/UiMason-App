import type { ReactNode } from "react";
import Sidebar from "../components/sidebar/Sidebar";
import type { ChatSession, UserProfile, Workspace } from "../types/chat";

type AppLayoutProps = {
  children: ReactNode;
  sessions: ChatSession[];
  activeSessionId: string | null;
  profile: UserProfile | null;
  workspace: Workspace | null;
  onNewProject: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onWorkspaceUpload: (files: FileList) => void;
  onClearWorkspace: () => void;
  onEditProfile: () => void;
  onDeleteProfile: () => void;
  onOpenSettings: () => void;
};

export default function AppLayout({
  children,
  sessions,
  activeSessionId,
  profile,
  workspace,
  onNewProject,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onWorkspaceUpload,
  onClearWorkspace,
  onEditProfile,
  onDeleteProfile,
  onOpenSettings,
}: AppLayoutProps) {
  return (
    <div className="app-layout">
      <Sidebar
        key={`${activeSessionId ?? "sidebar"}-${workspace?.id ?? ""}`}
        sessions={sessions}
        activeSessionId={activeSessionId}
        profile={profile}
        workspace={workspace}
        onNewProject={onNewProject}
        onSelectSession={onSelectSession}
        onRenameSession={onRenameSession}
        onDeleteSession={onDeleteSession}
        onWorkspaceUpload={onWorkspaceUpload}
        onClearWorkspace={onClearWorkspace}
        onEditProfile={onEditProfile}
        onDeleteProfile={onDeleteProfile}
        onOpenSettings={onOpenSettings}
      />
      <main className="main-content">{children}</main>
    </div>
  );
}