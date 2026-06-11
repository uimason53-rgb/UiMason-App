export type ChatRole = "assistant" | "user";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: ChatAttachment[];
};

export type ChatAttachment = {
  id: string;
  name: string;
  type: "file" | "image" | "folder";
  mimeType?: string;
  dataUrl?: string;
  size?: number;
  fileCount?: number;
  ext?: string;
};

export type WorkspaceNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  content?: string;
  children?: WorkspaceNode[];
};

export type Workspace = {
  id: string;
  name: string;
  tree: WorkspaceNode[];
  createdAt: number;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  workspaceId?: string;
  workspace?: Workspace; // workspace milik session ini sahaja
};

export type UserProfile = {
  name: string;
  avatarUrl?: string;
};