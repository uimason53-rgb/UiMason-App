import { useState, useRef } from "react";
import type { ChatSession, UserProfile, Workspace, WorkspaceNode } from "../../types/chat";
import ProfileSection from "../profile/ProfileSection";
import DeleteConfirmModal from "../modals/DeleteConfirmModal";
import WorkspaceTree from "./WorkspaceTree";

type SidebarProps = {
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

export default function Sidebar({
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
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const [previewFile, setPreviewFile] = useState<WorkspaceNode | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);

  const startRename = (session: ChatSession) => {
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const commitRename = (sessionId: string) => {
    if (editTitle.trim()) onRenameSession(sessionId, editTitle.trim());
    setEditingId(null);
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files?.length) onWorkspaceUpload(files);
    e.target.value = "";
  };

  return (
    <>
      {deleteTarget && (
        <DeleteConfirmModal
          title={deleteTarget.title}
          onConfirm={() => {
            onDeleteSession(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <aside className="sidebar">

        {/* ── Logo ── */}
        <div className="sidebar-logo-wrap">
          <div className="logo">
            <div className="logo-mark">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect width="18" height="18" rx="5" fill="var(--accent)" opacity="0.15"/>
                <rect x="3" y="3" width="5" height="5" rx="1.5" fill="var(--accent)"/>
                <rect x="10" y="3" width="5" height="5" rx="1.5" fill="var(--accent)" opacity="0.5"/>
                <rect x="3" y="10" width="5" height="5" rx="1.5" fill="var(--accent)" opacity="0.5"/>
                <rect x="10" y="10" width="5" height="5" rx="1.5" fill="var(--accent)"/>
              </svg>
            </div>
            <span className="logo-text">UiMason</span>
          </div>
        </div>

        {/* ── New Project ── */}
        <div className="sidebar-new-project-wrap">
          <button className="new-project-btn" onClick={onNewProject}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1V11M1 6H11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            New Project
          </button>
        </div>

        {/* ── Upload Folder ── */}
        <div className="sidebar-upload-wrap">
          {workspace ? (
            <div className="workspace-panel">
              <button className="workspace-root-row" onClick={() => setWorkspaceExpanded((v) => !v)}>
                <span className="ws-tree-icon">{workspaceExpanded ? "▾" : "▸"}</span>
                <span>📁</span>
                <span className="workspace-root-name">{workspace.name}</span>
                <button
                  className="workspace-clear-btn"
                  title="Remove workspace"
                  onClick={(e) => { e.stopPropagation(); onClearWorkspace(); }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </button>
              {workspaceExpanded && (
                <>
                  <div className="workspace-tree-wrap">
                    <WorkspaceTree
                      nodes={workspace.tree[0]?.children ?? workspace.tree}
                      selectedPath={previewFile?.path ?? null}
                      onFileSelect={setPreviewFile}
                    />
                  </div>
                  <div className="workspace-preview">
                    <div className="workspace-preview-header">
                      <span className="workspace-preview-title">Workspace preview</span>
                      <span className="workspace-preview-path">
                        {previewFile ? previewFile.path : "Select a file to preview its contents"}
                      </span>
                    </div>
                    <div className="workspace-preview-body">
                      {previewFile ? (
                        previewFile.content ? (
                          <pre>{previewFile.content}</pre>
                        ) : (
                          <div className="workspace-preview-empty">
                            Preview unavailable for this file type.
                          </div>
                        )
                      ) : (
                        <div className="workspace-preview-empty">
                          Click a file name to inspect code without leaving chat.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button className="upload-folder-btn" onClick={() => folderInputRef.current?.click()}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 4C1 3.45 1.45 3 2 3H4.5L6 4.5H11C11.55 4.5 12 4.95 12 5.5V10.5C12 11.05 11.55 11.5 11 11.5H2C1.45 11.5 1 11.05 1 10.5V4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              </svg>
              Upload Folder
            </button>
          )}

          <input
            ref={folderInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={handleFolderSelect}
            // @ts-expect-error WebKit directory attribute
            webkitdirectory="true"
            directory="true"
            multiple
          />
        </div>

        {/* ── Projects ── */}
        <div className="sidebar-section sidebar-projects">
          <p className="sidebar-label">Projects</p>
          <div className="project-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`project-item-wrap ${session.id === activeSessionId ? "is-active" : ""}`}
              >
                {editingId === session.id ? (
                  <input
                    className="project-rename-input"
                    value={editTitle}
                    autoFocus
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => commitRename(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(session.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    className="project-item"
                    onClick={() => onSelectSession(session.id)}
                    onDoubleClick={() => startRename(session)}
                    title="Double-click to rename"
                  >
                    <svg className="project-item-svg-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M1 2.5C1 1.95 1.45 1.5 2 1.5H5L6.5 3H10C10.55 3 11 3.45 11 4V9.5C11 10.05 10.55 10.5 10 10.5H2C1.45 10.5 1 10.05 1 9.5V2.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    </svg>
                    <span className="project-item-title">{session.title}</span>
                  </button>
                )}
                <button
                  className="project-delete-btn"
                  title="Delete project"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(session); }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Bottom ── */}
        <div className="sidebar-bottom">
          {/* Upgrade card */}
          <div className="sidebar-upgrade">
            <div className="sidebar-upgrade-icon">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M5.5 1L6.8 4L10 4.3L7.7 6.5L8.4 9.7L5.5 8.2L2.6 9.7L3.3 6.5L1 4.3L4.2 4L5.5 1Z" fill="var(--accent)"/>
              </svg>
            </div>
            <div className="sidebar-upgrade-text">
              <span className="sidebar-upgrade-title">Upgrade to Pro</span>
              <span className="sidebar-upgrade-sub">Unlock all features & deploy</span>
            </div>
            <button className="sidebar-upgrade-btn">Go Pro</button>
          </div>

          {/* Profile */}
          {profile ? (
            <ProfileSection
              profile={profile}
              onEditProfile={onEditProfile}
              onDeleteProfile={onDeleteProfile}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            <button className="setup-profile-btn" onClick={onEditProfile}>
              + Set up profile
            </button>
          )}
        </div>
      </aside>
    </>
  );
}