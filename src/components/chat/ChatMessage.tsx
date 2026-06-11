import { useState } from "react";
import type { ChatMessage as ChatMessageType } from "../../types/chat";

// ── helpers ───────────────────────────────────────────────────────────────────
const getExt = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const extColor: Record<string, string> = {
  ts:"#3178c6",tsx:"#3178c6",js:"#f7df1e",jsx:"#61dafb",
  py:"#3572a5",html:"#e34c26",css:"#563d7c",json:"#6b8e23",
  md:"#083fa1",pdf:"#e63946",png:"#2ecc71",jpg:"#2ecc71",
  jpeg:"#2ecc71",svg:"#ff7f50",zip:"#888",txt:"#aaa",
};

const FileIcon = ({ ext }: { ext: string }) => {
  const color = extColor[ext] ?? "#777";
  return (
    <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
      <rect x="4" y="2" width="18" height="24" rx="3" fill="#1a1a1a" stroke="#333" strokeWidth="1"/>
      <path d="M18 2 L26 10 L18 10 Z" fill={color} opacity="0.9"/>
      <rect x="18" y="2" width="8" height="8" rx="1" fill={color} opacity="0.15"/>
      <path d="M18 2 L22 2 L26 6 L26 10 L18 10 Z" fill={color} opacity="0.4"/>
      {ext && (
        <text x="13" y="22" textAnchor="middle" fill={color} fontSize="7" fontWeight="700" fontFamily="monospace">
          {ext.toUpperCase().slice(0,4)}
        </text>
      )}
    </svg>
  );
};

const FolderIcon = () => (
  <svg width="36" height="36" viewBox="0 0 32 32" fill="none">
    <path d="M3 8C3 6.9 3.9 6 5 6H12L15 9H27C28.1 9 29 9.9 29 11V24C29 25.1 28.1 26 27 26H5C3.9 26 3 25.1 3 24V8Z" fill="#b8955a" opacity="0.25"/>
    <path d="M3 12C3 10.9 3.9 10 5 10H27C28.1 10 29 10.9 29 12V24C29 25.1 28.1 26 27 26H5C3.9 26 3 25.1 3 24V12Z" fill="#b8955a" opacity="0.7"/>
    <path d="M3 13H29V14H3Z" fill="#c9a86e" opacity="0.3"/>
  </svg>
);

// ── Simple markdown renderer ──────────────────────────────────────────────────
// Supports: **bold**, `code`, line breaks
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => {
    // Parse inline: **bold** and `code`
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*|`([^`]+)`/g;
    let last = 0;
    let match;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > last) {
        parts.push(line.slice(last, match.index));
      }
      if (match[1] !== undefined) {
        parts.push(<strong key={match.index}>{match[1]}</strong>);
      } else if (match[2] !== undefined) {
        parts.push(<code key={match.index} className="msg-inline-code">{match[2]}</code>);
      }
      last = match.index + match[0].length;
    }

    if (last < line.length) parts.push(line.slice(last));

    return (
      <span key={lineIdx}>
        {parts}
        {lineIdx < lines.length - 1 && <br />}
      </span>
    );
  });
}

// ── Copy Button ───────────────────────────────────────────────────────────────
const CopyButton = ({ text, isUser }: { text: string; isUser: boolean }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      className={`chat-copy-btn ${copied ? "chat-copy-btn--copied" : ""} ${isUser ? "chat-copy-btn--user" : "chat-copy-btn--assistant"}`}
      onClick={handleCopy}
      title="Copy message"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
      <span>{copied ? "Copied!" : "Copy"}</span>
    </button>
  );
};

// ── component ────────────────────────────────────────────────────────────────
type Props = { message: ChatMessageType };

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`chat-message ${isUser ? "chat-message--user" : "chat-message--assistant"}`}>
      {!isUser && (
        <div className="chat-avatar">
          <div className="logo-dot" />
        </div>
      )}

      <div className="chat-bubble-wrapper">
        <div className="chat-bubble">
          {message.attachments?.length ? (
            <div className="msg-att-grid">
              {message.attachments.map((att) => (
                <div
                  key={att.id}
                  className={`msg-att-card msg-att-card--${att.type}`}
                  title={att.name}
                >
                  {att.type === "image" && att.dataUrl ? (
                    <img src={att.dataUrl} alt="" className="msg-att-img" />
                  ) : att.type === "folder" ? (
                    <FolderIcon />
                  ) : (
                    <FileIcon ext={getExt(att.name)} />
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {message.content && (
            <p className="chat-bubble-text">
              {renderMarkdown(message.content)}
            </p>
          )}
        </div>

        {message.content && (
          <CopyButton text={message.content} isUser={isUser} />
        )}
      </div>
    </div>
  );
}