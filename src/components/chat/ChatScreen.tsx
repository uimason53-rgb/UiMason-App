import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ChatSession, ChatAttachment, Workspace } from "../../types/chat";
import type { PendingDiff } from "../../hooks/useAgentRunner";
import type { StreamingState } from "../../hooks/useStreaming";
import ChatMessage from "./ChatMessage";

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const getExt = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

const extColor: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#f7df1e",
  jsx: "#61dafb",
  py: "#3572a5",
  html: "#e34c26",
  css: "#563d7c",
  json: "#6b8e23",
  md: "#083fa1",
  pdf: "#e63946",
  png: "#2ecc71",
  jpg: "#2ecc71",
  jpeg: "#2ecc71",
  svg: "#ff7f50",
  zip: "#888",
  txt: "#aaa",
};

type AttType = "image" | "file" | "folder";
type Att = { id: string; name: string; type: AttType; dataUrl?: string; fileCount?: number; ext?: string };

const FileIcon = ({ ext, size = 36 }: { ext: string; size?: number }) => {
  const color = extColor[ext] ?? "#777";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="4" y="2" width="18" height="24" rx="3" fill="#1a1a1a" stroke="#333" strokeWidth="1" />
      <path d="M18 2 L26 10 L18 10 Z" fill={color} opacity="0.9" />
      <rect x="18" y="2" width="8" height="8" rx="1" fill={color} opacity="0.15" />
      <path d="M18 2 L22 2 L26 6 L26 10 L18 10 Z" fill={color} opacity="0.4" />
      {ext && (
        <text x="13" y="22" textAnchor="middle" fill={color} fontSize="7" fontWeight="700" fontFamily="monospace">
          {ext.toUpperCase().slice(0, 4)}
        </text>
      )}
    </svg>
  );
};

const FolderIcon = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path
      d="M3 8C3 6.9 3.9 6 5 6H12L15 9H27C28.1 9 29 9.9 29 11V24C29 25.1 28.1 26 27 26H5C3.9 26 3 25.1 3 24V8Z"
      fill="#b8955a"
      opacity="0.25"
    />
    <path
      d="M3 12C3 10.9 3.9 10 5 10H27C28.1 10 29 10.9 29 12V24C29 25.1 28.1 26 27 26H5C3.9 26 3 25.1 3 24V12Z"
      fill="#b8955a"
      opacity="0.7"
    />
    <path d="M3 13H29V14H3Z" fill="#c9a86e" opacity="0.3" />
  </svg>
);

const WorkspaceIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M3 6.5C3 5.12 4.12 4 5.5 4H10l2 2.5h6.5C19.88 6.5 21 7.62 21 9v8.5c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 20 3 18.88 3 17.5v-11Z" />
  </svg>
);

const RemoveBtn = ({ onClick }: { onClick: () => void }) => (
  <button className="att-card__remove" onClick={onClick} title="Remove attachment" aria-label="Remove attachment">
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  </button>
);

type ChatScreenProps = {
  session: ChatSession;
  workspace: Workspace | null;
  onSendMessage: (message: string, attachments?: ChatAttachment[]) => void;
  inputFocusRef: MutableRefObject<(() => void) | null>;
  streaming?: StreamingState;
  pendingDiff?: PendingDiff | null;
};

export default function ChatScreen({
  session,
  workspace,
  onSendMessage,
  inputFocusRef,
  streaming,
  pendingDiff,
}: ChatScreenProps) {
  const [message, setMessage] = useState("");
  const [atts, setAtts] = useState<Att[]>([]);
  const [openPatchPath, setOpenPatchPath] = useState("");
  const [applyingPatchId, setApplyingPatchId] = useState("");
  const [selectionByPatchId, setSelectionByPatchId] = useState<Record<string, string[]>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 || atts.length > 0;
  const patchFiles = pendingDiff?.proposal.filePatches ?? [];
  const activePatchFile = patchFiles.find((filePatch) => filePatch.path === openPatchPath) ?? patchFiles[0];
  const allSelectableHunks = pendingDiff?.proposal.selectableHunks ?? [];
  const selectedHunkIds = pendingDiff
    ? selectionByPatchId[pendingDiff.proposal.id] ?? allSelectableHunks
    : [];
  const selectedHunkSet = new Set(selectedHunkIds);
  const selectedHunkCount = selectedHunkIds.length;
  const totalHunkCount = allSelectableHunks.length;
  const isApplyingPatch = Boolean(pendingDiff && applyingPatchId === pendingDiff.proposal.id);

  useEffect(() => {
    inputFocusRef.current = () => textareaRef.current?.focus();
    textareaRef.current?.focus();
  }, [inputFocusRef]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages, pendingDiff?.proposal.id]);

  const handleSubmit = () => {
    if (!canSend) return;

    const chatAtts: ChatAttachment[] = atts.map((att) => ({
      id: att.id,
      name: att.name,
      type: att.type === "folder" ? "file" : att.type,
      mimeType: "",
      size: 0,
      dataUrl: att.dataUrl,
    }));

    onSendMessage(trimmed, chatAtts.length ? chatAtts : undefined);
    setMessage("");
    setAtts([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(event.target.value);
    const el = event.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>, type: AttType) => {
    const files = event.target.files;
    if (!files?.length) return;

    if (type === "folder") {
      const folderName = (files[0].webkitRelativePath || files[0].name).split("/")[0];
      setAtts((prev) => [...prev, { id: uid(), name: folderName, type: "folder", fileCount: files.length }]);
    } else if (type === "image") {
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (readerEvent) => {
          setAtts((prev) => [...prev, { id: uid(), name: file.name, type: "image", dataUrl: readerEvent.target?.result as string }]);
        };
        reader.readAsDataURL(file);
      });
    } else {
      Array.from(files).forEach((file) => {
        setAtts((prev) => [...prev, { id: uid(), name: file.name, type: "file", ext: getExt(file.name) }]);
      });
    }

    event.target.value = "";
  };

  const remove = (id: string) => setAtts((prev) => prev.filter((att) => att.id !== id));

  const setPatchSelection = (hunkIds: string[]) => {
    if (!pendingDiff) return;
    setSelectionByPatchId((prev) => ({ ...prev, [pendingDiff.proposal.id]: hunkIds }));
  };

  const toggleHunk = (hunkId: string) => {
    if (!pendingDiff || isApplyingPatch) return;
    setSelectionByPatchId((prev) => {
      const current = prev[pendingDiff.proposal.id] ?? allSelectableHunks;
      const next = current.includes(hunkId) ? current.filter((id) => id !== hunkId) : [...current, hunkId];
      return { ...prev, [pendingDiff.proposal.id]: next };
    });
  };

  const toggleFile = (hunkIds: string[]) => {
    if (!pendingDiff || isApplyingPatch) return;
    setSelectionByPatchId((prev) => {
      const current = prev[pendingDiff.proposal.id] ?? allSelectableHunks;
      const fileFullySelected = hunkIds.every((id) => current.includes(id));
      const next = fileFullySelected
        ? current.filter((id) => !hunkIds.includes(id))
        : [...new Set([...current, ...hunkIds])];
      return { ...prev, [pendingDiff.proposal.id]: next };
    });
  };

  const handleApplyPatch = async () => {
    if (!pendingDiff || isApplyingPatch || selectedHunkCount === 0) return;
    setApplyingPatchId(pendingDiff.proposal.id);
    try {
      await pendingDiff.onAccept(selectedHunkIds);
    } finally {
      setApplyingPatchId("");
    }
  };

  return (
    <section className="chat-screen">
      {workspace && (
        <div className="chat-workspace-banner">
          <WorkspaceIcon />
          <span className="chat-workspace-name">{workspace.name}</span>
          <span className="chat-workspace-hint">active workspace</span>
        </div>
      )}

      <div className="chat-messages">
        {session.messages.length === 0 && (
          <ChatMessage
            message={{
              id: "starter",
              role: "assistant",
              content: workspace
                ? `Hello! I can see your workspace "${workspace.name}". What would you like to build or modify?`
                : "Hello, what would you like to build?",
            }}
          />
        )}
        {session.messages.map((chatMessage) => (
          <ChatMessage key={chatMessage.id} message={chatMessage} />
        ))}

        {streaming?.isStreaming && (
          <div className="streaming-overlay">
            {streaming.currentPhase !== "idle" && (
              <div className="streaming-phase">
                <span className="streaming-phase-dot" />
                {streaming.currentPhase}
              </div>
            )}
            {streaming.toolCalls.length > 0 && (
              <div className="streaming-tools">
                {streaming.toolCalls.slice(-3).map((toolCall, index) => (
                  <div key={`${toolCall}-${index}`} className="streaming-tool-item">{toolCall}</div>
                ))}
              </div>
            )}
            {streaming.buildLogs.length > 0 && (
              <div className="streaming-build">
                {streaming.buildLogs.slice(-5).map((log, index) => (
                  <div key={`${log}-${index}`} className="streaming-build-line">{log}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {pendingDiff && (
          <div className="patch-review-panel">
            <div className="patch-review-panel__header">
              <div>
                <span className="patch-review-panel__eyebrow">Patch proposal</span>
                <strong>{pendingDiff.summary}</strong>
                <small>
                  {pendingDiff.proposal.changedFiles.length} file(s) - {selectedHunkCount}/{totalHunkCount} hunk(s) selected
                  {" "} - +{pendingDiff.proposal.additions} -{pendingDiff.proposal.deletions}
                </small>
              </div>
              <div className="diff-approval-actions">
                <button className="diff-btn diff-btn--accept" onClick={handleApplyPatch} disabled={isApplyingPatch || selectedHunkCount === 0}>
                  {isApplyingPatch ? "Applying..." : "Apply Patch"}
                </button>
                <button className="diff-btn diff-btn--reject" onClick={pendingDiff.onReject} disabled={isApplyingPatch}>
                  Reject
                </button>
              </div>
            </div>

            <div className="patch-review-panel__toolbar">
              <span>{selectedHunkCount} selected</span>
              <button onClick={() => setPatchSelection(allSelectableHunks)} disabled={isApplyingPatch || selectedHunkCount === totalHunkCount}>
                Select all
              </button>
              <button onClick={() => setPatchSelection([])} disabled={isApplyingPatch || selectedHunkCount === 0}>
                Clear
              </button>
            </div>

            <div className="patch-review-panel__body">
              <div className="patch-file-list">
                {patchFiles.length === 0 ? (
                  <div className="patch-file-list__empty">No file changes.</div>
                ) : (
                  patchFiles.map((filePatch) => {
                    const fileHunkIds = filePatch.hunks.map((hunk) => hunk.id);
                    const selectedInFile = fileHunkIds.filter((id) => selectedHunkSet.has(id)).length;
                    const fileChecked = selectedInFile === fileHunkIds.length;
                    const filePartial = selectedInFile > 0 && !fileChecked;

                    return (
                      <div
                        key={filePatch.path}
                        className={`patch-file-item${activePatchFile?.path === filePatch.path ? " patch-file-item--active" : ""}`}
                      >
                        <button className="patch-file-item__main" onClick={() => setOpenPatchPath(filePatch.path)}>
                          <span>{filePatch.path}</span>
                          <small>{filePatch.status} - {selectedInFile}/{fileHunkIds.length} hunks - +{filePatch.additions} -{filePatch.deletions}</small>
                        </button>
                        <button
                          className={`patch-file-item__toggle${filePartial ? " patch-file-item__toggle--partial" : ""}`}
                          onClick={() => toggleFile(fileHunkIds)}
                          disabled={isApplyingPatch}
                          title={fileChecked ? "Exclude file hunks" : "Include file hunks"}
                          aria-label={fileChecked ? "Exclude file hunks" : "Include file hunks"}
                        >
                          {fileChecked ? "On" : filePartial ? "Some" : ""}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="patch-diff-preview">
                {activePatchFile ? (
                  <>
                    <div className="patch-diff-preview__title">{activePatchFile.path}</div>
                    <div className="patch-hunk-list">
                      {activePatchFile.hunks.length === 0 ? (
                        <div className="patch-diff-line patch-diff-line--empty">No hunk changes to show.</div>
                      ) : (
                        activePatchFile.hunks.map((hunk) => (
                          <div key={hunk.id} className={`patch-hunk-card${selectedHunkSet.has(hunk.id) ? "" : " patch-hunk-card--skipped"}`}>
                            <label className="patch-hunk-card__header">
                              <input
                                type="checkbox"
                                checked={selectedHunkSet.has(hunk.id)}
                                disabled={isApplyingPatch}
                                onChange={() => toggleHunk(hunk.id)}
                              />
                              <span>Hunk @{hunk.oldStart + 1} - +{hunk.additions} -{hunk.deletions}</span>
                            </label>
                            <div className="patch-diff-preview__lines">
                              {hunk.lines.slice(0, 90).map((line, index) => (
                                <div
                                  key={`${hunk.id}-${line.type}-${line.oldLine ?? 0}-${line.newLine ?? 0}-${index}`}
                                  className={`patch-diff-line patch-diff-line--${line.type}`}
                                >
                                  <span>{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}</span>
                                  <code>{line.content || " "}</code>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <div className="patch-diff-line patch-diff-line--empty">No patch selected.</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-wrap">
        {atts.length > 0 && (
          <div className="att-grid">
            {atts.map((att) => (
              <div key={att.id} className={`att-card att-card--${att.type}`}>
                <RemoveBtn onClick={() => remove(att.id)} />

                {att.type === "image" && att.dataUrl ? (
                  <>
                    <div className="att-card__img-wrap">
                      <img src={att.dataUrl} alt={att.name} className="att-card__img" />
                    </div>
                    <span className="att-card__label">{att.name}</span>
                  </>
                ) : att.type === "folder" ? (
                  <>
                    <div className="att-card__icon-wrap"><FolderIcon size={36} /></div>
                    <span className="att-card__label">{att.name}</span>
                    <span className="att-card__meta">{att.fileCount} files</span>
                  </>
                ) : (
                  <>
                    <div className="att-card__icon-wrap"><FileIcon ext={att.ext ?? ""} size={36} /></div>
                    <span className="att-card__label">{att.name}</span>
                    {att.ext && <span className="att-card__meta">.{att.ext}</span>}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-card">
          <div className="prompt-attach-btns">
            <button className="prompt-attach-btn" title="Upload files" onClick={() => fileRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button className="prompt-attach-btn" title="Upload folder" onClick={() => folderRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <button className="prompt-attach-btn" title="Upload image" onClick={() => imageRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          </div>

          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="Message UiMason..."
            value={message}
            rows={1}
            onChange={handleInput}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />

          <button className="chat-send-btn" disabled={!canSend} onClick={handleSubmit}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" style={{ display: "none" }} multiple onChange={(event) => handleFiles(event, "file")} />
      <input ref={imageRef} type="file" accept="image/*" style={{ display: "none" }} multiple onChange={(event) => handleFiles(event, "image")} />
      <input
        ref={folderRef}
        type="file"
        style={{ display: "none" }}
        // @ts-expect-error WebKit directory attribute
        webkitdirectory="true"
        directory="true"
        multiple
        onChange={(event) => handleFiles(event, "folder")}
      />
    </section>
  );
}
