import { useState, useRef } from "react";
import type { Workspace } from "../../types/chat";

type AttachmentType = "image" | "file" | "folder";

type Attachment = {
  id: string;
  name: string;
  type: AttachmentType;
  dataUrl?: string;
  fileCount?: number; // for folders
  ext?: string;       // file extension
};

type PromptBoxProps = {
  onGenerate: (prompt: string, attachments?: Attachment[]) => void;
  workspace: Workspace | null;
};

const getFileExt = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

const getExtColor = (ext: string): string => {
  const map: Record<string, string> = {
    ts: "#3178c6", tsx: "#3178c6", js: "#f7df1e", jsx: "#61dafb",
    py: "#3572a5", html: "#e34c26", css: "#563d7c", json: "#6b8e23",
    md: "#083fa1", pdf: "#e63946", png: "#2ecc71", jpg: "#2ecc71",
    jpeg: "#2ecc71", svg: "#ff7f50", zip: "#888", txt: "#aaa",
  };
  return map[ext] ?? "#777";
};

const FileIcon = ({ ext, size = 32 }: { ext: string; size?: number }) => {
  const color = getExtColor(ext);
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect x="4" y="2" width="18" height="24" rx="3" fill="#1a1a1a" stroke="#333" strokeWidth="1"/>
      <path d="M18 2 L26 10 L18 10 Z" fill={color} opacity="0.9"/>
      <rect x="18" y="2" width="8" height="8" rx="1" fill={color} opacity="0.15"/>
      <path d="M18 2 L22 2 L26 6 L26 10 L18 10 Z" fill={color} opacity="0.4"/>
      {ext && (
        <text x="13" y="22" textAnchor="middle" fill={color} fontSize="7" fontWeight="700" fontFamily="monospace">
          {ext.toUpperCase().slice(0, 4)}
        </text>
      )}
    </svg>
  );
};

const FolderIcon = ({ size = 32 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <path d="M3 8C3 6.9 3.9 6 5 6H12L15 9H27C28.1 9 29 9.9 29 11V24C29 25.1 28.1 26 27 26H5C3.9 26 3 25.1 3 24V8Z" fill="#b8955a" opacity="0.25"/>
    <path d="M3 12C3 10.9 3.9 10 5 10H27C28.1 10 29 10.9 29 12V24C29 25.1 28.1 26 27 26H5C3.9 26 3 25.1 3 24V12Z" fill="#b8955a" opacity="0.7"/>
    <path d="M3 13H29V14H3Z" fill="#c9a86e" opacity="0.3"/>
  </svg>
);

export default function PromptBox({ onGenerate, workspace }: PromptBoxProps) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const trimmedPrompt = prompt.trim();
  const canSend = trimmedPrompt.length > 0 || attachments.length > 0;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const createId = () => `${Date.now()}-${Math.random()}`;

  const handleSubmit = () => {
    if (!canSend) return;
    onGenerate(trimmedPrompt, attachments.length ? attachments : undefined);
    setPrompt("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>, type: AttachmentType) => {
    const files = e.target.files;
    if (!files?.length) return;

    if (type === "folder") {
      // Group all files under the folder name
      const folderName = (files[0].webkitRelativePath || files[0].name).split("/")[0];
      setAttachments((prev) => [
        ...prev,
        { id: createId(), name: folderName, type: "folder", fileCount: files.length },
      ]);
    } else if (type === "image") {
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setAttachments((prev) => [
            ...prev,
            { id: createId(), name: file.name, type: "image", dataUrl: ev.target?.result as string },
          ]);
        };
        reader.readAsDataURL(file);
      });
    } else {
      Array.from(files).forEach((file) => {
        setAttachments((prev) => [
          ...prev,
          { id: createId(), name: file.name, type: "file", ext: getFileExt(file.name) },
        ]);
      });
    }

    e.target.value = "";
  };

  const remove = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  return (
    <div className="prompt-container">
      {workspace && (
        <div className="prompt-workspace-badge">
          <span>📁</span>
          <span>{workspace.name}</span>
          <span className="prompt-workspace-hint">workspace loaded</span>
        </div>
      )}

      {/* Attachment preview grid */}
      {attachments.length > 0 && (
        <div className="att-grid">
          {attachments.map((att) => (
            <div key={att.id} className={`att-card att-card--${att.type}`}>
              <button className="att-card__remove" onClick={() => remove(att.id)} title="Remove">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>

              {att.type === "image" && att.dataUrl ? (
                <>
                  <div className="att-card__img-wrap">
                    <img src={att.dataUrl} alt={att.name} className="att-card__img" />
                  </div>
                  <span className="att-card__label">{att.name}</span>
                </>
              ) : att.type === "folder" ? (
                <>
                  <div className="att-card__icon-wrap">
                    <FolderIcon size={36} />
                  </div>
                  <span className="att-card__label">{att.name}</span>
                  <span className="att-card__meta">{att.fileCount} files</span>
                </>
              ) : (
                <>
                  <div className="att-card__icon-wrap">
                    <FileIcon ext={att.ext ?? ""} size={36} />
                  </div>
                  <span className="att-card__label">{att.name}</span>
                  {att.ext && <span className="att-card__meta">.{att.ext}</span>}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="prompt-card prompt-card--inline">
        {/* Left: attach buttons */}
        <div className="prompt-attach-btns">
          {/* File */}
          <button className="prompt-attach-btn" title="Upload files" onClick={() => fileInputRef.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          {/* Folder */}
          <button className="prompt-attach-btn" title="Upload folder" onClick={() => folderInputRef.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          {/* Image */}
          <button className="prompt-attach-btn" title="Upload image" onClick={() => imageInputRef.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
        </div>

        <textarea
          ref={textareaRef}
          className="prompt-textarea prompt-textarea--inline"
          placeholder="Describe your product idea..."
          value={prompt}
          rows={1}
          onChange={handleInput}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
          }}
        />

        <button className="generate-btn generate-btn--inline" disabled={!canSend} onClick={handleSubmit}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>

      {/* Hidden inputs */}
      <input ref={fileInputRef} type="file" style={{ display: "none" }} multiple onChange={(e) => handleFiles(e, "file")} />
      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} multiple onChange={(e) => handleFiles(e, "image")} />
      <input
        ref={folderInputRef}
        type="file"
        style={{ display: "none" }}
        // @ts-expect-error WebKit directory attribute
        webkitdirectory="true"
        directory="true"
        multiple
        onChange={(e) => handleFiles(e, "folder")}
      />
    </div>
  );
}
