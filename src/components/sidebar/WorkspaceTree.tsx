import { useState } from "react";
import type { WorkspaceNode } from "../../types/chat";

type Props = {
  nodes: WorkspaceNode[];
  depth?: number;
  selectedPath?: string | null;
  onFileSelect?: (node: WorkspaceNode) => void;
};

export default function WorkspaceTree({ nodes, depth = 0, selectedPath, onFileSelect }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (path: string) =>
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }));

  return (
    <ul className="ws-tree" style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      {nodes.map((node) => {
        const isFolder = node.type === "folder";
        const isOpen = !collapsed[node.path];
        const isSelected = selectedPath === node.path;

        return (
          <li key={node.path} className="ws-tree-item">
            <button
              className={`ws-tree-row ${isFolder ? "ws-tree-folder" : "ws-tree-file"} ${isSelected ? "ws-tree-row--selected" : ""}`}
              onClick={() => {
                if (isFolder) {
                  toggle(node.path);
                } else if (onFileSelect) {
                  onFileSelect(node);
                }
              }}
              title={node.path}
            >
              <span className="ws-tree-icon">
                {isFolder ? (isOpen ? "▾" : "▸") : null}
              </span>
              <span className="ws-tree-file-icon">
                {isFolder ? "📁" : getFileIcon(node.name)}
              </span>
              <span className="ws-tree-name">{node.name}</span>
            </button>

            {isFolder && isOpen && node.children?.length ? (
              <WorkspaceTree
                nodes={node.children}
                depth={depth + 1}
                selectedPath={selectedPath}
                onFileSelect={onFileSelect}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    tsx: "⚛", ts: "📘", jsx: "⚛", js: "📙",
    css: "🎨", scss: "🎨", html: "🌐",
    json: "📋", md: "📝", txt: "📄",
    png: "🖼", jpg: "🖼", jpeg: "🖼", svg: "🖼", webp: "🖼",
    env: "🔒",
  };
  return map[ext] ?? "📄";
}
