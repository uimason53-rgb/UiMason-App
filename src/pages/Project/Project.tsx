import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import type { editor } from "monaco-editor";
import type { GeneratedFile } from "../../services/claudeService";
import type { LogEntry } from "../../services/agentService";
import {
  TsLanguageService,
  type DiagnosticResult,
  type ReferenceLocation,
  type RenameEdit,
  type WorkspaceSymbol,
} from "../../services/codeIntel/tsLanguageService";
import { getPreviewUrl, getSandboxStatus, onPreviewUrl, onStatusChange, startDevServer, teardownContainer, type SandboxStatus } from "../../services/sandboxService";
import { getDeployments, smartDeploy, type DeploymentRecord, type DeployResult } from "../../services/deployService";
import {
  createGitHubPullRequest,
  listGitHubBranches,
  listGitHubRepos,
  getGitHubStatus,
  startGitHubOAuth,
  type GitHubBranch,
  type GitHubPullRequestResult,
  type GitHubRepo,
  type GitHubStatus,
} from "../../services/githubService";
import {
  analyzeDeploymentPreflight,
  createCheckpoint,
  deleteCheckpoint,
  getProjectCheckpoints,
  getWorkingTreeStatus,
  type DeploymentPreflight,
  type ProjectCheckpoint,
  type WorkingTreeStatus,
} from "../../services/workflowService";

// ── Types ────────────────────────────────────────────────────
type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  content?: string;
};

type ProjectProps = {
  projectName?: string;
  files?: GeneratedFile[];
  logs?: LogEntry[];
  isGenerating?: boolean;
  onFilesChange?: (files: GeneratedFile[]) => void;
};

type TabType = "code" | "preview" | "terminal" | "source" | "deploy";
type SearchMatch = {
  filePath: string;
  line: number;
  column: number;
  preview: string;
};
type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  run: () => void;
};

// ── Preview helpers ───────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────
const getLang = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX",
    py: "Python", html: "HTML", css: "CSS", json: "JSON",
    md: "Markdown", sh: "Bash", env: "ENV", yml: "YAML",
    yaml: "YAML", txt: "Text", sql: "SQL",
  };
  return map[ext] ?? "Text";
};

const extColor: Record<string, string> = {
  ts: "#3178c6", tsx: "#61dafb", js: "#f7df1e", jsx: "#61dafb",
  py: "#3572a5", html: "#e34c26", css: "#563d7c", json: "#6b8e23",
  md: "#083fa1", sh: "#89e051", env: "#eee", yml: "#cc1018",
  yaml: "#cc1018", sql: "#e38c00",
};

const getExtColor = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return extColor[ext] ?? "#555";
};

const getMonacoLanguage = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", html: "html", css: "css", json: "json",
    md: "markdown", sh: "bash", env: "plaintext", yml: "yaml",
    yaml: "yaml", txt: "plaintext", sql: "sql",
    vue: "vue", svelte: "svelte", xml: "xml", c: "c", cpp: "cpp",
    java: "java", go: "go", rs: "rust", rb: "ruby", php: "php",
  };
  return map[ext] ?? "plaintext";
};

const HIDDEN_FILES = new Set([".gitkeep", ".keep"]);

const normalizePath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();

const getParentPath = (path: string): string => {
  const normalized = normalizePath(path);
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? "" : normalized.slice(0, idx);
};

const getFileName = (path: string): string => normalizePath(path).split("/").pop() || path;

const makeUniquePath = (files: GeneratedFile[], path: string): string => {
  const normalized = normalizePath(path);
  if (!files.some((file) => file.path === normalized)) return normalized;
  const dot = normalized.lastIndexOf(".");
  const slash = normalized.lastIndexOf("/");
  const hasExt = dot > slash;
  const base = hasExt ? normalized.slice(0, dot) : normalized;
  const ext = hasExt ? normalized.slice(dot) : "";
  let i = 2;
  while (files.some((file) => file.path === `${base}-${i}${ext}`)) i += 1;
  return `${base}-${i}${ext}`;
};

const flattenTreeFiles = (nodes: FileNode[]): FileNode[] =>
  nodes.flatMap((node) => node.type === "file" ? [node] : flattenTreeFiles(node.children ?? []));

const searchFiles = (files: GeneratedFile[], query: string): SearchMatch[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: SearchMatch[] = [];
  for (const file of files) {
    const lines = (file.content ?? "").split("\n");
    lines.forEach((line, index) => {
      const column = line.toLowerCase().indexOf(q);
      if (column >= 0) {
        matches.push({
          filePath: file.path,
          line: index + 1,
          column: column + 1,
          preview: line.trim() || "(blank line)",
        });
      }
    });
  }
  return matches.slice(0, 500);
};

const buildFileTree = (files: GeneratedFile[]): FileNode[] => {
  const root: FileNode[] = [];
  const folderMap = new Map<string, FileNode>();

  const ensureFolder = (parts: string[]): FileNode => {
    const path = parts.join("/");
    if (folderMap.has(path)) return folderMap.get(path)!;
    const node: FileNode = { name: parts[parts.length - 1], path, type: "folder", children: [] };
    folderMap.set(path, node);
    if (parts.length === 1) {
      root.push(node);
    } else {
      const parent = ensureFolder(parts.slice(0, -1));
      parent.children!.push(node);
    }
    return node;
  };

  files.forEach((file) => {
    const parts = file.path.split("/");
    const fileName = parts[parts.length - 1];
    const shouldHide = HIDDEN_FILES.has(fileName);
    if (parts.length === 1) {
      if (!shouldHide) {
        root.push({ name: file.path, path: file.path, type: "file", content: file.content });
      }
    } else {
      const folderParts = parts.slice(0, -1);
      const folder = ensureFolder(folderParts);
      if (!shouldHide) {
        folder.children!.push({
          name: fileName,
          path: file.path,
          type: "file",
          content: file.content,
        });
      }
    }
  });

  return root;
};

const filterTree = (nodes: FileNode[], query: string): FileNode[] => {
  if (!query.trim()) return nodes;
  const normalized = query.toLowerCase();

  const matches = (node: FileNode): boolean =>
    node.name.toLowerCase().includes(normalized) || (node.content?.toLowerCase().includes(normalized) ?? false);

  const walk = (items: FileNode[]): FileNode[] => {
    return items
      .map((node) => {
        if (node.type === "file") {
          return matches(node) ? node : null;
        }
        const children = walk(node.children ?? []);
        if (children.length > 0 || matches(node)) {
          return { ...node, children };
        }
        return null;
      })
      .filter((node): node is FileNode => node !== null);
  };

  return walk(nodes);
};

// ── Icons ─────────────────────────────────────────────────────
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="10" height="10" viewBox="0 0 10 10" fill="none"
    style={{ flexShrink: 0, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
  >
    <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FolderIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
    <path
      d="M1 3C1 2.45 1.45 2 2 2H5L6.5 3.5H12C12.55 3.5 13 3.95 13 4.5V11C13 11.55 12.55 12 12 12H2C1.45 12 1 11.55 1 11V3Z"
      fill="#b8955a"
      opacity={open ? 0.55 : 0.3}
    />
    {open && <path d="M1 5.5H13V6.5H1Z" fill="#c9a86e" opacity="0.2" />}
  </svg>
);

const FileDot = ({ name }: { name: string }) => (
  <span style={{
    width: 6, height: 6, borderRadius: 1.5, flexShrink: 0,
    background: getExtColor(name), display: "inline-block",
  }} />
);

// ── File Tree Node with Context Menu ─────────────────────────
function TreeNode({
  node, depth, selectedPath, onSelect, onCreateFile, onCreateFolder, onRenameFile, onDeleteFile, onDuplicateFile,
}: {
  node: FileNode; depth: number; selectedPath: string | null; onSelect: (n: FileNode) => void;
  onCreateFile?: (parentPath: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRenameFile?: (oldPath: string) => void;
  onDeleteFile?: (path: string) => void;
  onDuplicateFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [showMenu, setShowMenu] = useState(false);
  const isFolder = node.type === "folder";
  const isActive = !isFolder && selectedPath === node.path;

  return (
    <div>
      <div
        className={`tree-node${isActive ? " tree-node--active" : ""}`}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        onClick={() => isFolder ? setOpen((o) => !o) : onSelect(node)}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowMenu(true);
        }}
      >
        {isFolder
          ? <><ChevronIcon open={open} /><FolderIcon open={open} /></>
          : <><span style={{ width: 10, flexShrink: 0 }} /><FileDot name={node.name} /></>
        }
        <span className="tree-node__name">{node.name}</span>
        {showMenu && (
          <div className="tree-node__menu" onClick={(e) => e.stopPropagation()}>
            {isFolder && (
              <>
                <button onClick={() => { onCreateFile?.(node.path); setShowMenu(false); }}>
                  ➕ New File
                </button>
                <button onClick={() => { onCreateFolder?.(node.path); setShowMenu(false); }}>
                  📁 New Folder
                </button>
              </>
            )}
            {!isFolder && (
              <button onClick={() => { onDuplicateFile?.(node.path); setShowMenu(false); }}>
                ⧉ Duplicate
              </button>
            )}
            <button onClick={() => { onRenameFile?.(node.path); setShowMenu(false); }}>
              ✏️ Rename
            </button>
            <button onClick={() => { onDeleteFile?.(node.path); setShowMenu(false); }} style={{ color: "#e05c5c" }}>
              🗑️ Delete
            </button>
          </div>
        )}
      </div>
      {isFolder && open && node.children?.map((child) => (
        <TreeNode 
          key={child.path} 
          node={child} 
          depth={depth + 1} 
          selectedPath={selectedPath} 
          onSelect={onSelect}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onRenameFile={onRenameFile}
          onDeleteFile={onDeleteFile}
          onDuplicateFile={onDuplicateFile}
        />
      ))}
    </div>
  );
}

// ── Code Viewer ───────────────────────────────────────────────
function CodeViewer({
  file,
  files,
  content,
  onChange,
  onSave,
  onReset,
  onFilesChange,
  onSelectFile,
  isModified,
}: {
  file: FileNode | null;
  files: GeneratedFile[];
  content: string;
  onChange: (next: string) => void;
  onSave: () => void;
  onReset: () => void;
  onFilesChange?: (next: GeneratedFile[]) => void;
  onSelectFile?: (path: string) => void;
  isModified: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diagnosticCount, setDiagnosticCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [references, setReferences] = useState<ReferenceLocation[]>([]);
  const [workspaceSymbols, setWorkspaceSymbols] = useState<WorkspaceSymbol[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [activeIntelPanel, setActiveIntelPanel] = useState<"problems" | "references" | "symbols" | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const codeIntelRef = useRef<TsLanguageService | null>(null);
  const pendingNavigationRef = useRef<{ filePath: string; range: monaco.IRange } | null>(null);

  const initializeCodeIntel = useCallback(
    async (editor: editor.IStandaloneCodeEditor, monacoInstance: typeof monaco) => {
      if (!file) return;
      editorRef.current = editor;
      monacoRef.current = monacoInstance;
      if (!codeIntelRef.current) {
        codeIntelRef.current = new TsLanguageService();
      }
      codeIntelRef.current.updateFiles(files);
      await codeIntelRef.current.init(monacoInstance, files);
      const nextDiagnostics = await codeIntelRef.current.updateAllDiagnostics();
      setDiagnostics(nextDiagnostics);
      setDiagnosticCount(nextDiagnostics.length);
    },
    [file, files]
  );

  const refreshDiagnostics = useCallback(async () => {
    if (!file || !codeIntelRef.current) return;
    const nextDiagnostics = await codeIntelRef.current.updateAllDiagnostics();
    setDiagnostics(nextDiagnostics);
    setDiagnosticCount(nextDiagnostics.length);
  }, [file]);

  const applyRenameEdits = useCallback(
    (edits: RenameEdit[]) => {
      const monacoInstance = monacoRef.current;
      if (!edits.length || !onFilesChange || !monacoInstance) return;
      const nextFiles = files.map((nextFile) => {
        const fileEdits = edits.find((item) => item.filePath === nextFile.path);
        if (!fileEdits) return nextFile;
        let updated = nextFile.content ?? "";
        const sortedEdits = [...fileEdits.edits].sort((a, b) => {
          if (a.range.startLineNumber !== b.range.startLineNumber) {
            return b.range.startLineNumber - a.range.startLineNumber;
          }
          return b.range.startColumn - a.range.startColumn;
        });
        const model = monacoInstance.editor.getModel(monacoInstance.Uri.parse(`inmemory://model/${encodeURIComponent(nextFile.path)}`));
        for (const edit of sortedEdits) {
          const start = model?.getOffsetAt({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn }) ?? 0;
          const end = model?.getOffsetAt({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn }) ?? start;
          updated = updated.slice(0, start) + edit.newText + updated.slice(end);
        }
        return { ...nextFile, content: updated };
      });
      onFilesChange(nextFiles);
    },
    [files, onFilesChange]
  );

  const canNavigate = file ? /\.(jsx|tsx|js|ts)$/i.test(file.name) : false;
  const originalContent = file?.content ?? "";
  const currentLanguage = file ? getMonacoLanguage(file.name) : "plaintext";

  useEffect(() => {
    if (!file || !codeIntelRef.current || !monacoRef.current) return;
    codeIntelRef.current.updateFiles(files);
    codeIntelRef.current.setFileContent(file.path, content).catch(() => {});
    void refreshDiagnostics();
  }, [content, file, files, refreshDiagnostics]);

  useEffect(() => {
    const pending = pendingNavigationRef.current;
    if (!file || !editorRef.current || !pending || pending.filePath !== file.path) return;
    window.setTimeout(() => {
      editorRef.current?.setSelection(pending.range);
      editorRef.current?.revealRangeInCenter(pending.range);
      editorRef.current?.focus();
      pendingNavigationRef.current = null;
    }, 80);
  }, [file]);

  const revealLocation = (filePath: string, range: monaco.IRange) => {
    if (filePath !== file?.path) {
      pendingNavigationRef.current = { filePath, range };
      onSelectFile?.(filePath);
      return;
    }
    editorRef.current?.setSelection(range);
    editorRef.current?.revealRangeInCenter(range);
    editorRef.current?.focus();
  };

  const loadWorkspaceSymbols = async (query = symbolQuery) => {
    if (!codeIntelRef.current) return;
    const symbols = await codeIntelRef.current.getWorkspaceSymbols(query);
    setWorkspaceSymbols(symbols.slice(0, 120));
  };

  if (!file || file.type !== "file") {
    return (
      <div className="code-empty">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" opacity="0.15">
          <rect x="6" y="4" width="22" height="30" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M22 4L34 16L22 16Z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 22H28M12 26H22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>Select a file to view</span>
      </div>
    );
  }

  const goToDefinition = async () => {
    if (!file || !editorRef.current || !codeIntelRef.current) return;
    const position = editorRef.current.getPosition();
    if (!position) return;
    const targets = await codeIntelRef.current.getDefinition(file.path, position);
    if (targets.length === 0) return;
    const target = targets[0];
    revealLocation(target.filePath, target.range);
  };

  const findReferences = async () => {
    if (!file || !editorRef.current || !codeIntelRef.current) return;
    const position = editorRef.current.getPosition();
    if (!position) return;
    const references = await codeIntelRef.current.findReferences(file.path, position);
    if (references.length === 0) return;
    setReferences(references);
    setActiveIntelPanel("references");
  };

  const renameSymbol = async () => {
    if (!file || !editorRef.current || !codeIntelRef.current) return;
    const position = editorRef.current.getPosition();
    if (!position) return;
    const newName = prompt("Rename symbol to:", "");
    if (!newName) return;
    const edits = await codeIntelRef.current.renameSymbol(file.path, position, newName);
    if (!edits.length) {
      alert("Rename did not find any symbol locations.");
      return;
    }
    applyRenameEdits(edits);
    void refreshDiagnostics();
  };

  const copy = () => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const format = () => {
    editorRef.current?.getAction("editor.action.formatDocument")?.run();
  };

  const editorOptions: editor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    wordWrap: "on",
    fontSize: 13,
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    lineNumbersMinChars: 3,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: { top: 12, bottom: 12 },
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    parameterHints: { enabled: true },
    wordBasedSuggestions: "currentDocument",
    tabCompletion: "on",
    renderLineHighlight: "all",
  };

  return (
    <div className="code-viewer">
      <div className="code-viewer__header">
        <div className="code-viewer__file-info">
          <FileDot name={file.name} />
          <span className="code-viewer__filename">{file.path}</span>
          <span className="code-viewer__lang">{getLang(file.name)}</span>
        </div>
        <div className="code-viewer__actions">
          <button
            className={`code-nav-btn${activeIntelPanel === "problems" ? " code-nav-btn--active" : ""}`}
            onClick={() => setActiveIntelPanel((panel) => panel === "problems" ? null : "problems")}
            title="Show workspace diagnostics"
          >
            Problems {diagnosticCount > 0 ? diagnosticCount : ""}
          </button>
          {canNavigate && (
            <>
              <button className="code-nav-btn" onClick={goToDefinition} title="Go to definition">
                Go Definition
              </button>
              <button className="code-nav-btn" onClick={findReferences} title="Find references">
                Find Refs
              </button>
              <button className="code-nav-btn" onClick={renameSymbol} title="Rename symbol">
                Rename
              </button>
              <button
                className={`code-nav-btn${activeIntelPanel === "symbols" ? " code-nav-btn--active" : ""}`}
                onClick={() => {
                  setActiveIntelPanel((panel) => panel === "symbols" ? null : "symbols");
                  void loadWorkspaceSymbols();
                }}
                title="Search workspace symbols"
              >
                Symbols
              </button>
            </>
          )}
          {isModified && (
            <button className="code-diff-btn" onClick={() => setShowDiff((prev) => !prev)} title="Toggle diff view">
              {showDiff ? "Hide Diff" : "Show Diff"}
            </button>
          )}
          <button className={`code-copy-btn${isModified ? " code-copy-btn--secondary" : ""}`} onClick={copy} title="Copy to clipboard">
            {copied ? (
              <>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="#b8955a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ color: "#4caf7d" }}>Copied!</span>
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <rect x="3.5" y=".5" width="7" height="8" rx="1" stroke="currentColor" strokeWidth=".9" />
                  <rect x=".5" y="2.5" width="7" height="8" rx="1" fill="var(--bg-secondary)" stroke="currentColor" strokeWidth=".9" />
                </svg>
                Copy
              </>
            )}
          </button>
          <button className="code-format-btn" onClick={format} title="Format document (Shift+Alt+F)">
            🎯 Format
          </button>
          <button className="code-save-btn" disabled={!isModified} onClick={onSave} title="Save changes">
            Save
          </button>
          <button className="code-reset-btn" disabled={!isModified} onClick={onReset} title="Discard changes">
            Reset
          </button>
        </div>
      </div>
      <div className="code-viewer__body">
        {showDiff && isModified ? (
          <DiffEditor
            height="100%"
            original={originalContent}
            modified={content}
            language={currentLanguage}
            theme="vs-dark"
            options={editorOptions}
          />
        ) : (
          <Editor
            height="100%"
            defaultLanguage={currentLanguage}
            path={`inmemory://model/${encodeURIComponent(file.path)}`}
            value={content}
            onChange={(value) => onChange(value ?? "")}
            onMount={(editor, monaco) => {
              void initializeCodeIntel(editor, monaco);
            }}
            theme="vs-dark"
            options={editorOptions}
          />
        )}
      </div>
      {activeIntelPanel && (
        <div className="code-intel-panel">
          <div className="code-intel-panel__header">
            <strong>
              {activeIntelPanel === "problems" && "Problems"}
              {activeIntelPanel === "references" && `References (${references.length})`}
              {activeIntelPanel === "symbols" && "Workspace Symbols"}
            </strong>
            <button onClick={() => setActiveIntelPanel(null)} aria-label="Close code intelligence panel">x</button>
          </div>

          {activeIntelPanel === "problems" && (
            <div className="code-intel-panel__list">
              {diagnostics.length === 0 ? (
                <div className="code-intel-panel__empty">No TypeScript or JavaScript diagnostics.</div>
              ) : (
                diagnostics.map((item, index) => (
                  <button
                    key={`${item.filePath}-${item.range.startLineNumber}-${item.range.startColumn}-${index}`}
                    className={`code-intel-item code-intel-item--${item.severity}`}
                    onClick={() => revealLocation(item.filePath, item.range)}
                  >
                    <span>{item.filePath}:{item.range.startLineNumber}:{item.range.startColumn}</span>
                    <small>{item.message}</small>
                  </button>
                ))
              )}
            </div>
          )}

          {activeIntelPanel === "references" && (
            <div className="code-intel-panel__list">
              {references.length === 0 ? (
                <div className="code-intel-panel__empty">No references selected.</div>
              ) : (
                references.map((item, index) => (
                  <button
                    key={`${item.filePath}-${item.range.startLineNumber}-${item.range.startColumn}-${index}`}
                    className="code-intel-item"
                    onClick={() => revealLocation(item.filePath, item.range)}
                  >
                    <span>{item.filePath}:{item.range.startLineNumber}:{item.range.startColumn}{item.isDefinition ? " definition" : ""}</span>
                    <small>{item.text || "(reference)"}</small>
                  </button>
                ))
              )}
            </div>
          )}

          {activeIntelPanel === "symbols" && (
            <>
              <div className="code-intel-panel__search">
                <input
                  value={symbolQuery}
                  onChange={(event) => {
                    setSymbolQuery(event.target.value);
                    void loadWorkspaceSymbols(event.target.value);
                  }}
                  placeholder="Search symbols..."
                />
              </div>
              <div className="code-intel-panel__list">
                {workspaceSymbols.length === 0 ? (
                  <div className="code-intel-panel__empty">No symbols found.</div>
                ) : (
                  workspaceSymbols.map((item, index) => (
                    <button
                      key={`${item.filePath}-${item.name}-${item.range.startLineNumber}-${index}`}
                      className="code-intel-item"
                      onClick={() => revealLocation(item.filePath, item.range)}
                    >
                      <span>{item.name} <em>{item.kind}</em></span>
                      <small>{item.filePath}:{item.range.startLineNumber}</small>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
      {isModified && (
        <div className="code-viewer__status">Unsaved changes in {file.name}</div>
      )}
    </div>
  );
}

// ── Terminal ──────────────────────────────────────────────────
const LOG_ICONS: Record<LogEntry["type"], { icon: string; color: string }> = {
  info:    { icon: "ℹ", color: "#6b8fa8" },
  success: { icon: "✓", color: "#4caf7d" },
  error:   { icon: "✕", color: "#e05c5c" },
  warning: { icon: "⚠", color: "#d4a017" },
  running: { icon: "◌", color: "#b8955a" },
};

function Terminal({ logs, isGenerating }: { logs: LogEntry[]; isGenerating?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="terminal">
      <div className="terminal__header">
        <div className="terminal__dots">
          <span /><span /><span />
        </div>
        <span className="terminal__title">Output Log</span>
        {isGenerating && <span className="terminal__badge terminal__badge--running">Running</span>}
        {!isGenerating && logs.length > 0 && <span className="terminal__badge terminal__badge--done">Done</span>}
      </div>
      <div className="terminal__body">
        {logs.length === 0 && <div className="terminal__empty">Waiting for output...</div>}
        {logs.map((log) => {
          const { icon, color } = LOG_ICONS[log.type];
          return (
            <div key={log.id} className={`terminal__line terminal__line--${log.type}`}>
              <span className="terminal__ts">{log.timestamp}</span>
              <span className="terminal__icon" style={{ color }}>{icon}</span>
              <span className="terminal__msg">{log.message}</span>
              {log.type === "running" && isGenerating && <span className="terminal__spinner" />}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── Download helper ──────────────────────────────────────────
type JSZipConstructor = new () => {
  file(path: string, content: string): void;
  generateAsync(options: {
    type: "blob";
    compression: "DEFLATE";
    compressionOptions: { level: number };
  }): Promise<Blob>;
};

async function loadJSZip(): Promise<JSZipConstructor> {
  return new Promise((resolve, reject) => {
    const win = window as Window & { JSZip?: JSZipConstructor };
    if (win.JSZip) { resolve(win.JSZip); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = () => {
      if (win.JSZip) {
        resolve(win.JSZip);
      } else {
        reject(new Error("Failed to load JSZip"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load JSZip"));
    document.head.appendChild(script);
  });
}

async function downloadFilesAsZip(files: GeneratedFile[], projectName: string) {
  if (files.length === 0) return;
  try {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    files.forEach((f) => zip.file(`${projectName}/${f.path}`, f.content ?? ""));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${projectName}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.warn("JSZip unavailable, falling back to .txt download", err);
    const blob = new Blob(
      [files.map((f) => `// ── ${f.path} ──\n${f.content}`).join("\n\n")],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${projectName}.txt`; a.click();
    URL.revokeObjectURL(url);
  }
}

// ── Preview Tab — WebContainer live iframe ──────────────────
function LivePreviewTab({
  files,
}: {
  files: GeneratedFile[];
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState<string | null>(getPreviewUrl);
  const [status, setStatusState] = useState<SandboxStatus>(getSandboxStatus);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    const unsubUrl = onPreviewUrl((u) => setUrl(u));
    const unsubStatus = onStatusChange((s) => setStatusState(s));
    return () => { unsubUrl(); unsubStatus(); };
  }, []);

  const handleLaunch = useCallback(async () => {
    if (launching) return;
    const currentUrl = getPreviewUrl();
    if (currentUrl) {
      setUrl(currentUrl);
      return;
    }
    setLaunching(true);
    try {
      await startDevServer();
    } finally {
      setLaunching(false);
    }
  }, [launching]);

  // Auto-launch on files change
  useEffect(() => {
    if (files.length > 0 && !getPreviewUrl() && status !== "booting") {
      void Promise.resolve().then(handleLaunch);
    }
  }, [files, status, handleLaunch]);

  if (!url) {
    return (
      <div className="preview-tab-placeholder">
        {status === "booting" || status === "installing" || status === "building" || launching ? (
          <>
            <span className="terminal__spinner" style={{ width: 22, height: 22 }} />
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>
              {status === "booting" && "Booting WebContainer..."}
              {status === "installing" && "Installing dependencies..."}
              {status === "building" && "Building project..."}
              {launching && "Starting dev server..."}
            </p>
          </>
        ) : status === "error" ? (
          <>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity="0.4">
              <circle cx="16" cy="16" r="14" stroke="#e05c5c" strokeWidth="1.5" />
              <path d="M11 11L21 21M21 11L11 21" stroke="#e05c5c" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p style={{ marginTop: 12, fontSize: 13, color: "#e05c5c" }}>Build failed — check Terminal for errors</p>
          </>
        ) : (
          <>
            <button
              className="proj-action-btn proj-action-btn--preview"
              onClick={handleLaunch}
              disabled={launching}
              style={{ marginBottom: 8 }}
            >
              {launching ? "Launching..." : "Launch Live Preview"}
            </button>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Requires WebContainer browser support</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="preview-tab-iframe">
      <div className="preview-tab-bar">
        <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {url}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="proj-action-btn"
            onClick={() => { setUrl(null); iframeRef.current?.contentWindow?.location.reload(); setTimeout(() => setUrl(url), 100); }}
            title="Refresh preview"
            style={{ padding: "2px 8px", fontSize: 11 }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        src={url}
        title="Live Preview"
        style={{
          width: "100%",
          height: "calc(100% - 32px)",
          border: "none",
          background: "#fff",
        }}
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}

function QuickOpenDialog({
  files,
  onSelect,
  onClose,
}: {
  files: FileNode[];
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files
      .filter((file) => !q || file.path.toLowerCase().includes(q) || file.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [files, query]);

  return (
    <div className="ide-popover-backdrop" onMouseDown={onClose}>
      <div className="ide-popover" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="ide-popover__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && results[0]) {
              onSelect(results[0].path);
              onClose();
            }
          }}
          placeholder="Quick open file"
        />
        <div className="ide-popover__list">
          {results.map((file) => (
            <button key={file.path} className="ide-popover__item" onClick={() => { onSelect(file.path); onClose(); }}>
              <FileDot name={file.name} />
              <span>{file.path}</span>
            </button>
          ))}
          {results.length === 0 && <div className="ide-popover__empty">No files found.</div>}
        </div>
      </div>
    </div>
  );
}

function CommandPalette({ commands, onClose }: { commands: CommandItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands.filter((command) => !q || command.label.toLowerCase().includes(q) || command.hint?.toLowerCase().includes(q));
  }, [commands, query]);

  return (
    <div className="ide-popover-backdrop" onMouseDown={onClose}>
      <div className="ide-popover" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="ide-popover__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && results[0]) {
              results[0].run();
              onClose();
            }
          }}
          placeholder="Run command"
        />
        <div className="ide-popover__list">
          {results.map((command) => (
            <button key={command.id} className="ide-popover__item" onClick={() => { command.run(); onClose(); }}>
              <span>{command.label}</span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchPanel({
  query,
  replace,
  matches,
  onQueryChange,
  onReplaceChange,
  onReplaceAll,
  onSelect,
  onClose,
}: {
  query: string;
  replace: string;
  matches: SearchMatch[];
  onQueryChange: (query: string) => void;
  onReplaceChange: (replace: string) => void;
  onReplaceAll: () => void;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="ide-search-panel">
      <div className="ide-search-panel__header">
        <span>Search</span>
        <button onClick={onClose} title="Close search" aria-label="Close search">x</button>
      </div>
      <input className="project-search-input" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Find in files" />
      <input className="project-search-input" value={replace} onChange={(e) => onReplaceChange(e.target.value)} placeholder="Replace" />
      <button className="proj-action-btn" onClick={onReplaceAll} disabled={!query || matches.length === 0}>
        Replace All
      </button>
      <div className="ide-search-panel__meta">{matches.length} matches</div>
      <div className="ide-search-panel__results">
        {matches.map((match, index) => (
          <button key={`${match.filePath}:${match.line}:${index}`} onClick={() => onSelect(match.filePath)}>
            <span>{match.filePath}:{match.line}:{match.column}</span>
            <small>{match.preview}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ── Main Project Page ─────────────────────────────────────────
function SourceControlPanel({
  status,
  checkpoints,
  checkpointMessage,
  onMessageChange,
  onCreateCheckpoint,
  onRestoreCheckpoint,
  onDeleteCheckpoint,
  onSelectFile,
  githubStatus,
  githubRepos,
  githubBranches,
  selectedRepo,
  selectedBaseBranch,
  branchName,
  githubBusy,
  githubError,
  githubPrResult,
  onSelectedRepoChange,
  onBaseBranchChange,
  onBranchNameChange,
  onConnectSourceControl,
  onRefreshGitHub,
  onCreatePullRequest,
}: {
  status: WorkingTreeStatus;
  checkpoints: ProjectCheckpoint[];
  checkpointMessage: string;
  onMessageChange: (message: string) => void;
  onCreateCheckpoint: () => void;
  onRestoreCheckpoint: (checkpoint: ProjectCheckpoint) => void;
  onDeleteCheckpoint: (checkpointId: string) => void;
  onSelectFile: (path: string) => void;
  githubStatus: GitHubStatus | null;
  githubRepos: GitHubRepo[];
  githubBranches: GitHubBranch[];
  selectedRepo: string;
  selectedBaseBranch: string;
  branchName: string;
  githubBusy: boolean;
  githubError: string | null;
  githubPrResult: GitHubPullRequestResult | null;
  onSelectedRepoChange: (repo: string) => void;
  onBaseBranchChange: (branch: string) => void;
  onBranchNameChange: (branch: string) => void;
  onConnectSourceControl: () => void;
  onRefreshGitHub: () => void;
  onCreatePullRequest: () => void;
}) {
  return (
    <div className="workflow-panel">
      <div className="workflow-panel__section">
        <div className="workflow-panel__header">
          <div>
            <strong>Source Control</strong>
            <span>{status.clean ? "Working tree clean" : `${status.changedFiles.length} changed file(s)`}</span>
          </div>
          <b>{status.additions} add / {status.deletions} del</b>
        </div>
        <textarea
          className="workflow-panel__message"
          value={checkpointMessage}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder={status.suggestedCommitMessage.split("\n")[0] || "Checkpoint message"}
        />
        <button className="proj-action-btn proj-action-btn--primary" onClick={onCreateCheckpoint} disabled={status.clean}>
          Create Checkpoint
        </button>
        <div className="workflow-file-list">
          {status.changedFiles.length === 0 ? (
            <div className="workflow-empty">No changes since the latest checkpoint.</div>
          ) : (
            status.changedFiles.map((diff) => (
              <button key={diff.filePath} className="workflow-file-row" onClick={() => onSelectFile(diff.filePath)}>
                <span className={`workflow-badge workflow-badge--${diff.status}`}>{diff.status[0].toUpperCase()}</span>
                <span>{diff.filePath}</span>
                <small>+{diff.additions} -{diff.deletions}</small>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="workflow-panel__section">
        <div className="workflow-panel__header">
          <div>
            <strong>Checkpoints</strong>
            <span>{checkpoints.length} saved snapshot(s)</span>
          </div>
        </div>
        <div className="workflow-history">
          {checkpoints.length === 0 ? (
            <div className="workflow-empty">Create a checkpoint before risky edits or deploys.</div>
          ) : (
            checkpoints.map((checkpoint) => (
              <div className="workflow-history-item" key={checkpoint.id}>
                <div>
                  <strong>{checkpoint.message}</strong>
                  <span>{new Date(checkpoint.createdAt).toLocaleString()} - {checkpoint.fileCount} files</span>
                  <small>{checkpoint.summary}</small>
                </div>
                <div className="workflow-history-item__actions">
                  <button onClick={() => onRestoreCheckpoint(checkpoint)}>Restore</button>
                  <button onClick={() => onDeleteCheckpoint(checkpoint.id)}>Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="workflow-panel__section">
        <div className="workflow-panel__header">
          <div>
            <strong>Pull request</strong>
            <span>{githubStatus?.connected ? `Connected as ${githubStatus.username}` : "Connect source control to publish changes"}</span>
          </div>
          <button className="proj-action-btn" onClick={onRefreshGitHub} disabled={githubBusy}>Refresh</button>
        </div>
        {!githubStatus?.connected && (
          <div className="workflow-github-connect">
            <div className="workflow-empty">Connect once to choose a repository and open a pull request.</div>
            <button className="proj-action-btn proj-action-btn--primary" onClick={onConnectSourceControl} disabled={githubBusy}>
              {githubBusy ? "Connecting..." : "Connect and continue"}
            </button>
          </div>
        )}
        {githubStatus?.connected && (
          <div className="workflow-github-form">
            <label>
              <span>Repository</span>
              <select value={selectedRepo} onChange={(event) => onSelectedRepoChange(event.target.value)}>
                <option value="">Select repo</option>
                {githubRepos.map((repo) => (
                  <option key={repo.id} value={repo.fullName} disabled={!repo.canPush}>
                    {repo.fullName}{repo.canPush ? "" : " (read-only)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Base branch</span>
              <select value={selectedBaseBranch} onChange={(event) => onBaseBranchChange(event.target.value)} disabled={!selectedRepo}>
                {githubBranches.length === 0 && <option value="">Load repo first</option>}
                {githubBranches.map((branch) => (
                  <option key={branch.sha} value={branch.name}>{branch.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Feature branch</span>
              <input value={branchName} onChange={(event) => onBranchNameChange(event.target.value)} placeholder="uimason/update-app" />
            </label>
            <button
              className="proj-action-btn proj-action-btn--primary"
              onClick={onCreatePullRequest}
              disabled={githubBusy || !selectedRepo || !selectedBaseBranch || !branchName || status.clean}
            >
              Create Branch + Commit + PR
            </button>
          </div>
        )}
        {githubPrResult && (
          <button className="workflow-live-link" onClick={() => window.open(githubPrResult.pullRequestUrl, "_blank", "noopener,noreferrer")}>
            Open PR #{githubPrResult.pullRequestNumber}
          </button>
        )}
        {githubError && <div className="workflow-error">{githubError}</div>}
      </div>
    </div>
  );
}

function DeployWorkflowPanel({
  preflight,
  deploying,
  deployResult,
  deployError,
  deploymentHistory,
  onDeploy,
  onRefreshHistory,
}: {
  preflight: DeploymentPreflight;
  deploying: boolean;
  deployResult: DeployResult | null;
  deployError: string | null;
  deploymentHistory: DeploymentRecord[];
  onDeploy: () => void;
  onRefreshHistory: () => void;
}) {
  return (
    <div className="workflow-panel">
      <div className="workflow-panel__section">
        <div className="workflow-panel__header">
          <div>
            <strong>Deployment Readiness</strong>
            <span>{preflight.config.framework} to {preflight.config.target}</span>
          </div>
          <b className={preflight.ready ? "workflow-status--pass" : "workflow-status--fail"}>
            {preflight.ready ? "Ready" : "Blocked"}
          </b>
        </div>
        <div className="workflow-grid">
          <span>Build</span><b>{preflight.config.buildCommand || "Static"}</b>
          <span>Output</span><b>{preflight.config.outputDir}</b>
          <span>Project</span><b>{preflight.config.projectName}</b>
        </div>
        <div className="workflow-checks">
          {preflight.checks.map((check) => (
            <div className="workflow-check" key={check.id}>
              <span className={`workflow-dot workflow-dot--${check.status}`} />
              <div>
                <strong>{check.label}</strong>
                <small>{check.detail}</small>
              </div>
            </div>
          ))}
        </div>
        <button
          className="proj-action-btn proj-action-btn--primary"
          onClick={onDeploy}
          disabled={deploying || !preflight.ready}
        >
          {deploying ? "Deploying..." : "Deploy Current Checkpoint"}
        </button>
        {deployResult?.success && (
          <button className="workflow-live-link" onClick={() => window.open(deployResult.url, "_blank", "noopener,noreferrer")}>
            Open live deployment
          </button>
        )}
        {deployError && <div className="workflow-error">{deployError}</div>}
      </div>

      <div className="workflow-panel__section">
        <div className="workflow-panel__header">
          <div>
            <strong>Deployment History</strong>
            <span>{deploymentHistory.length} backend record(s)</span>
          </div>
          <button className="proj-action-btn" onClick={onRefreshHistory}>Refresh</button>
        </div>
        <div className="workflow-history">
          {deploymentHistory.length === 0 ? (
            <div className="workflow-empty">No deployments recorded yet.</div>
          ) : (
            deploymentHistory.map((deployment) => (
              <div className="workflow-history-item" key={deployment.id}>
                <div>
                  <strong>{deployment.projectName}</strong>
                  <span>{deployment.provider} - {deployment.status} - {new Date(deployment.createdAt).toLocaleString()}</span>
                  <small>{deployment.deploymentUrl}</small>
                </div>
                {deployment.deploymentUrl && (
                  <button onClick={() => window.open(deployment.deploymentUrl, "_blank", "noopener,noreferrer")}>Open</button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function Project({
  projectName = "my-app",
  files: rawFiles = [],
  logs = [],
  isGenerating = false,
  onFilesChange,
}: ProjectProps) {
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editedFiles, setEditedFiles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<TabType>("code");
  const [splitPreview, setSplitPreview] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalReplace, setGlobalReplace] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [, setCheckpointRevision] = useState(0);
  const [checkpointMessage, setCheckpointMessage] = useState("");
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentRecord[]>([]);
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubBranches, setGithubBranches] = useState<GitHubBranch[]>([]);
  const [selectedGithubRepo, setSelectedGithubRepo] = useState("");
  const [selectedGithubBaseBranch, setSelectedGithubBaseBranch] = useState("");
  const [githubBranchName, setGithubBranchName] = useState(() => `uimason/${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubPrResult, setGithubPrResult] = useState<GitHubPullRequestResult | null>(null);

  const tree = useMemo(() => buildFileTree(rawFiles), [rawFiles]);
  const filteredTree = useMemo(() => filterTree(tree, searchTerm), [tree, searchTerm]);
  const flatFiles = useMemo(() => flattenTreeFiles(tree), [tree]);
  const globalMatches = useMemo(() => searchFiles(rawFiles, globalQuery), [rawFiles, globalQuery]);
  const totalFiles = rawFiles.length;
  const selectedPath = selectedFile?.path ?? null;
  const effectiveFiles = useMemo(
    () => rawFiles.map((file) => editedFiles[file.path] !== undefined ? { ...file, content: editedFiles[file.path] } : file),
    [rawFiles, editedFiles]
  );
  const selectedContent = selectedFile ? editedFiles[selectedFile.path] ?? selectedFile.content ?? "" : "";
  const isModified = Boolean(selectedFile && editedFiles[selectedFile.path] !== undefined && editedFiles[selectedFile.path] !== selectedFile.content);
  const dirtyCount = Object.keys(editedFiles).length;
  const workingTreeStatus = useMemo<WorkingTreeStatus>(
    () => getWorkingTreeStatus(projectName, effectiveFiles, checkpointMessage || "Update project"),
    [projectName, effectiveFiles, checkpointMessage]
  );
  const deploymentPreflight = useMemo<DeploymentPreflight>(
    () => analyzeDeploymentPreflight(effectiveFiles),
    [effectiveFiles]
  );
  const checkpoints = getProjectCheckpoints(projectName);

  const reloadCheckpoints = useCallback(() => {
    setCheckpointRevision((revision) => revision + 1);
  }, []);

  const refreshDeploymentHistory = useCallback(async () => {
    const records = await getDeployments();
    setDeploymentHistory(records.filter((record) => record.projectName === projectName));
  }, [projectName]);

  const refreshGitHub = useCallback(async () => {
    setGithubBusy(true);
    setGithubError(null);
    try {
      const status = await getGitHubStatus();
      setGithubStatus(status);
      if (status.connected) {
        const repos = await listGitHubRepos();
        setGithubRepos(repos);
      }
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "Failed to refresh GitHub");
    } finally {
      setGithubBusy(false);
    }
  }, []);

  const handleConnectSourceControl = useCallback(async () => {
    setGithubBusy(true);
    setGithubError(null);
    try {
      const { url } = await startGitHubOAuth();
      window.location.href = url;
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "Source control connection is not configured.");
      setGithubBusy(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(refreshGitHub);
  }, [refreshGitHub]);

  const selectFileByPath = useCallback((path: string) => {
    const file = rawFiles.find((item) => item.path === path);
    if (!file) return;
    setSelectedFile({ name: getFileName(path), path, type: "file", content: file.content });
    setOpenTabs((tabs) => tabs.includes(path) ? tabs : [...tabs, path]);
    setActiveTab("code");
  }, [rawFiles]);

  useEffect(() => {
    if (selectedFile && !rawFiles.some((file) => file.path === selectedFile.path)) {
      const fallback = rawFiles[0];
      window.setTimeout(() => {
        if (fallback) {
          selectFileByPath(fallback.path);
        } else {
          setSelectedFile(null);
          setOpenTabs([]);
        }
      }, 0);
    }
  }, [rawFiles, selectedFile, selectFileByPath]);

  const closeTab = useCallback((path: string) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== path);
      if (selectedFile?.path === path) {
        const fallbackPath = next[next.length - 1];
        if (fallbackPath) {
          const fallback = rawFiles.find((file) => file.path === fallbackPath);
          setSelectedFile(fallback ? { name: getFileName(fallback.path), path: fallback.path, type: "file", content: fallback.content } : null);
        } else {
          setSelectedFile(null);
        }
      }
      return next;
    });
  }, [rawFiles, selectedFile?.path]);

  const handleDownload = async () => {
    if (downloading || rawFiles.length === 0) return;
    setDownloading(true);
    try { await downloadFilesAsZip(effectiveFiles, projectName); } finally { setDownloading(false); }
  };

  // Cleanup container on unmount
  useEffect(() => {
    return () => { teardownContainer(); };
  }, []);

  const handleCreateCheckpoint = useCallback(() => {
    if (effectiveFiles.length === 0) return;
    const message = checkpointMessage || workingTreeStatus.suggestedCommitMessage.split("\n")[0];
    createCheckpoint(projectName, effectiveFiles, message, "manual");
    setCheckpointMessage("");
    setEditedFiles({});
    onFilesChange?.(effectiveFiles);
    reloadCheckpoints();
  }, [checkpointMessage, effectiveFiles, onFilesChange, projectName, reloadCheckpoints, workingTreeStatus.suggestedCommitMessage]);

  const handleRestoreCheckpoint = useCallback((checkpoint: ProjectCheckpoint) => {
    if (!confirm(`Restore checkpoint "${checkpoint.message}"? Current unsaved changes will be replaced.`)) return;
    setEditedFiles({});
    onFilesChange?.(checkpoint.files);
    setSelectedFile((current) => {
      if (!current) return checkpoint.files[0] ? { name: getFileName(checkpoint.files[0].path), path: checkpoint.files[0].path, type: "file", content: checkpoint.files[0].content } : null;
      const restored = checkpoint.files.find((file) => file.path === current.path);
      return restored ? { ...current, content: restored.content } : null;
    });
    setOpenTabs((tabs) => tabs.filter((path) => checkpoint.files.some((file) => file.path === path)));
    reloadCheckpoints();
  }, [onFilesChange, reloadCheckpoints]);

  const handleDeleteCheckpoint = useCallback((checkpointId: string) => {
    deleteCheckpoint(projectName, checkpointId);
    reloadCheckpoints();
  }, [projectName, reloadCheckpoints]);

  const handleSelectedGithubRepoChange = useCallback(async (fullName: string) => {
    setSelectedGithubRepo(fullName);
    setGithubBranches([]);
    setSelectedGithubBaseBranch("");
    setGithubError(null);
    if (!fullName.includes("/")) return;
    const [owner, repo] = fullName.split("/");
    setGithubBusy(true);
    try {
      const branches = await listGitHubBranches(owner, repo);
      setGithubBranches(branches);
      const repoMeta = githubRepos.find((item) => item.fullName === fullName);
      setSelectedGithubBaseBranch(repoMeta?.defaultBranch || branches[0]?.name || "");
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "Failed to load repo branches");
    } finally {
      setGithubBusy(false);
    }
  }, [githubRepos]);

  const handleCreateGitHubPullRequest = useCallback(async () => {
    if (!selectedGithubRepo.includes("/") || !selectedGithubBaseBranch || !githubBranchName || workingTreeStatus.clean) return;
    const [owner, repo] = selectedGithubRepo.split("/");
    setGithubBusy(true);
    setGithubError(null);
    setGithubPrResult(null);
    try {
      const message = checkpointMessage || workingTreeStatus.suggestedCommitMessage.split("\n")[0] || `feat: update ${projectName}`;
      createCheckpoint(projectName, effectiveFiles, message, "manual");
      setCheckpointMessage("");
      setEditedFiles({});
      onFilesChange?.(effectiveFiles);
      reloadCheckpoints();

      const result = await createGitHubPullRequest({
        owner,
        repo,
        baseBranch: selectedGithubBaseBranch,
        branchName: githubBranchName,
        title: message,
        body: [
          `Project: ${projectName}`,
          "",
          "Changes:",
          workingTreeStatus.changedFiles.map((diff) => `- ${diff.status}: ${diff.filePath} (+${diff.additions}/-${diff.deletions})`).join("\n"),
        ].join("\n"),
        commitMessage: message,
        files: effectiveFiles,
      });
      setGithubPrResult(result);
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "Failed to create pull request");
    } finally {
      setGithubBusy(false);
    }
  }, [
    checkpointMessage,
    effectiveFiles,
    githubBranchName,
    onFilesChange,
    projectName,
    reloadCheckpoints,
    selectedGithubBaseBranch,
    selectedGithubRepo,
    workingTreeStatus,
  ]);

  const handleDeploy = async () => {
    if (deploying || effectiveFiles.length === 0) return;
    if (!deploymentPreflight.ready) {
      setDeployError("Deployment preflight failed. Fix blocked checks first.");
      setActiveTab("deploy");
      return;
    }
    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);
    setActiveTab("deploy");
    try {
      if (!workingTreeStatus.clean) {
        createCheckpoint(projectName, effectiveFiles, checkpointMessage || "deploy: checkpoint before deployment", "deploy");
        setCheckpointMessage("");
        setEditedFiles({});
        onFilesChange?.(effectiveFiles);
        reloadCheckpoints();
      }
      const result = await smartDeploy(effectiveFiles, projectName);
      setDeployResult(result);
      await refreshDeploymentHistory();
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleUpdateFile = (path: string, content: string) => {
    setEditedFiles((prev) => ({ ...prev, [path]: content }));
  };

  const handleSaveFile = () => {
    if (!selectedFile) return;
    const nextFiles = rawFiles.map((file) =>
      file.path === selectedFile.path ? { ...file, content: selectedContent } : file
    );
    setEditedFiles((prev) => {
      const next = { ...prev };
      delete next[selectedFile.path];
      return next;
    });
    onFilesChange?.(nextFiles);
  };

  const handleResetFile = () => {
    if (!selectedFile) return;
    setEditedFiles((prev) => {
      const next = { ...prev };
      delete next[selectedFile.path];
      return next;
    });
  };

  const handleCreateFile = (parentPath: string) => {
    const fileName = prompt("New file name:", parentPath ? `${parentPath}/` : "src/");
    if (!fileName) return;
    const normalized = normalizePath(fileName.includes("/") ? fileName : `${parentPath}/${fileName}`);
    const newPath = makeUniquePath(rawFiles, normalized);
    const newFile: GeneratedFile = { path: newPath, content: "" };
    onFilesChange?.([...rawFiles, newFile]);
    setSelectedFile({ name: getFileName(newPath), path: newPath, type: "file", content: "" });
    setOpenTabs((tabs) => tabs.includes(newPath) ? tabs : [...tabs, newPath]);
    setActiveTab("code");
  };

  const handleCreateFolder = (parentPath: string) => {
    const folderName = prompt("New folder name:", parentPath ? `${parentPath}/` : "src/");
    if (!folderName) return;
    const folderPath = normalizePath(folderName.includes("/") ? folderName : `${parentPath}/${folderName}`);
    const keepPath = makeUniquePath(rawFiles, `${folderPath}/.gitkeep`);
    onFilesChange?.([...rawFiles, { path: keepPath, content: "" }]);
  };

  const handleRenameFile = (oldPath: string) => {
    const isFolder = !rawFiles.some((file) => file.path === oldPath) && rawFiles.some((file) => file.path.startsWith(`${oldPath}/`));
    const nextValue = prompt(isFolder ? "Rename folder to:" : "Rename file to:", oldPath);
    if (!nextValue) return;
    const newPath = normalizePath(nextValue.includes("/") ? nextValue : `${getParentPath(oldPath)}/${nextValue}`);
    if (newPath === oldPath) return;

    const updatedFiles = rawFiles.map((f) => {
      if (isFolder && f.path.startsWith(`${oldPath}/`)) {
        return { ...f, path: `${newPath}/${f.path.slice(oldPath.length + 1)}` };
      }
      if (f.path === oldPath) {
        return { ...f, path: makeUniquePath(rawFiles.filter((file) => file.path !== oldPath), newPath) };
      }
      return f;
    });
    onFilesChange?.(updatedFiles);
    if (selectedFile?.path === oldPath) {
      setSelectedFile({ ...selectedFile, path: newPath, name: getFileName(newPath) });
    }
    setOpenTabs((tabs) => tabs.map((tab) => tab === oldPath ? newPath : tab.startsWith(`${oldPath}/`) ? `${newPath}/${tab.slice(oldPath.length + 1)}` : tab));
  };

  const handleDeleteFile = (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    const isFolder = rawFiles.some((file) => file.path.startsWith(`${path}/`));
    const updatedFiles = rawFiles.filter((f) => isFolder ? !f.path.startsWith(`${path}/`) : f.path !== path);
    onFilesChange?.(updatedFiles);
    if (selectedFile?.path === path || selectedFile?.path.startsWith(`${path}/`)) {
      setSelectedFile(null);
    }
    setOpenTabs((tabs) => tabs.filter((tab) => isFolder ? !tab.startsWith(`${path}/`) : tab !== path));
  };

  const handleDuplicateFile = (path: string) => {
    const file = rawFiles.find((item) => item.path === path);
    if (!file) return;
    const newPath = makeUniquePath(rawFiles, path.replace(/(\.[^/.]+)?$/, "-copy$1"));
    onFilesChange?.([...rawFiles, { path: newPath, content: file.content }]);
    setSelectedFile({ name: getFileName(newPath), path: newPath, type: "file", content: file.content });
    setOpenTabs((tabs) => [...tabs, newPath]);
    setActiveTab("code");
  };

  const handleReplaceAll = () => {
    if (!globalQuery) return;
    const nextFiles = rawFiles.map((file) => ({
      ...file,
      content: (file.content ?? "").split(globalQuery).join(globalReplace),
    }));
    onFilesChange?.(nextFiles);
    setEditedFiles({});
  };

  const handleSaveAll = useCallback(() => {
    if (Object.keys(editedFiles).length === 0) return;
    const nextFiles = rawFiles.map((file) =>
      editedFiles[file.path] !== undefined ? { ...file, content: editedFiles[file.path] } : file
    );
    setEditedFiles({});
    onFilesChange?.(nextFiles);
  }, [editedFiles, rawFiles, onFilesChange]);

  const commandItems: CommandItem[] = [
    { id: "quick-open", label: "Quick Open File", shortcut: "Ctrl+P", run: () => setShowQuickOpen(true) },
    { id: "global-search", label: "Search In Project", shortcut: "Ctrl+Shift+F", run: () => setShowSearchPanel((v) => !v) },
    { id: "new-file", label: "New File", shortcut: "Ctrl+N", run: () => handleCreateFile(selectedFile ? getParentPath(selectedFile.path) : "") },
    { id: "new-folder", label: "New Folder", run: () => handleCreateFolder(selectedFile ? getParentPath(selectedFile.path) : "") },
    { id: "save-file", label: "Save Current File", shortcut: "Ctrl+S", run: handleSaveFile },
    { id: "save-all", label: "Save All Files", run: handleSaveAll },
    { id: "checkpoint", label: "Create Checkpoint", run: handleCreateCheckpoint },
    { id: "toggle-preview", label: "Toggle Split Preview", run: () => setSplitPreview((v) => !v) },
    { id: "show-code", label: "Show Code", run: () => setActiveTab("code") },
    { id: "show-preview", label: "Show Preview", run: () => setActiveTab("preview") },
    { id: "show-terminal", label: "Show Terminal", run: () => setActiveTab("terminal") },
    { id: "show-source", label: "Show Source Control", run: () => setActiveTab("source") },
    { id: "show-deploy", label: "Show Deploy Workflow", run: () => setActiveTab("deploy") },
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "p") {
        event.preventDefault();
        setShowQuickOpen(true);
      } else if (key === "k") {
        event.preventDefault();
        setShowCommandPalette(true);
      } else if (key === "s") {
        event.preventDefault();
        handleSaveAll();
      } else if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setShowSearchPanel((v) => !v);
      } else if (key === "w" && selectedFile) {
        event.preventDefault();
        closeTab(selectedFile.path);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeTab, handleSaveAll, selectedFile]);

  return (
    <div className="project-page">
      {/* ── Header ── */}
      <div className="project-header">
        <div className="project-header__left">
          <div className="project-header__icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 2C1 1.45 1.45 1 2 1H5.5L7 2.5H12C12.55 2.5 13 2.95 13 3.5V12C13 12.55 12.55 13 12 13H2C1.45 13 1 12.55 1 12V2Z" fill="#b8955a" opacity="0.7" />
            </svg>
          </div>
          <span className="project-header__name">{projectName}</span>
          <span className="project-header__meta">{totalFiles} files</span>
          {dirtyCount > 0 && <span className="project-header__meta">{dirtyCount} unsaved</span>}
        </div>

        <div className="project-header__actions">
          <button className="proj-action-btn" onClick={() => setShowQuickOpen(true)} title="Quick open file (Ctrl+P)">
            Quick Open
          </button>
          <button className="proj-action-btn" onClick={() => setShowCommandPalette(true)} title="Command palette (Ctrl+K)">
            Commands
          </button>
          <button className="proj-action-btn" onClick={() => setShowSearchPanel((v) => !v)} title="Search in project (Ctrl+Shift+F)">
            Search
          </button>
          <button className="proj-action-btn" onClick={() => setActiveTab("source")} title="Open source control and checkpoints">
            Source
          </button>
          <button
            className="proj-action-btn"
            onClick={handleDownload}
            disabled={downloading || rawFiles.length === 0}
            title="Download project as .zip folder"
          >
            {downloading ? (
              <><span className="terminal__spinner" style={{ width: 11, height: 11 }} />Zipping...</>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M6.5 1v8M3 6.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M1 10.5v1a.5.5 0 00.5.5h10a.5.5 0 00.5-.5v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Download .zip
              </>
            )}
          </button>
          <button
            className="proj-action-btn proj-action-btn--primary"
            onClick={handleDeploy}
            disabled={deploying || effectiveFiles.length === 0 || !deploymentPreflight.ready}
            title={deploying ? "Deploying..." : deployResult ? `Deployed to ${deployResult.url}` : deploymentPreflight.ready ? "Deploy to Vercel/Netlify" : "Deployment preflight blocked"}
          >
            {deploying ? (
              <><span className="terminal__spinner" style={{ width: 11, height: 11 }} />Deploying...</>
            ) : deployResult?.success ? (
              <>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="5.5" fill="#4caf7d" stroke="#4caf7d" strokeWidth="1.2" />
                  <path d="M4 6.5l2 2 3.5-4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Live
              </>
            ) : deployError ? (
              <>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="#e05c5c" strokeWidth="1.2" />
                  <path d="M4.5 4.5L8.5 8.5M8.5 4.5L4.5 8.5" stroke="#e05c5c" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Retry
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 6.5l2 2 3.5-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Deploy
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="project-body">
        {showSearchPanel && (
          <SearchPanel
            query={globalQuery}
            replace={globalReplace}
            matches={globalMatches}
            onQueryChange={setGlobalQuery}
            onReplaceChange={setGlobalReplace}
            onReplaceAll={handleReplaceAll}
            onSelect={selectFileByPath}
            onClose={() => setShowSearchPanel(false)}
          />
        )}
        <div className="project-tree">
          <div className="project-tree__header">
            <span>Explorer</span>
            <div className="project-tree__tools">
              <button onClick={() => handleCreateFile("")} title="New file" aria-label="New file">+</button>
              <button onClick={() => handleCreateFolder("")} title="New folder" aria-label="New folder">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 4.5C2 3.67 2.67 3 3.5 3H6l1.3 1.5h5.2c.83 0 1.5.67 1.5 1.5v6.5c0 .83-.67 1.5-1.5 1.5h-9C2.67 14 2 13.33 2 12.5v-8Z" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </button>
            </div>
          </div>
          <div className="project-tree__search">
            <input
              className="project-search-input"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search files or text..."
            />
          </div>
          <div className="project-tree__list">
            {filteredTree.length === 0 ? (
              <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--text-muted)" }}>
                No matching files.
              </div>
            ) : (
              filteredTree.map((node) => (
                <TreeNode 
                  key={node.path} 
                  node={node} 
                  depth={0} 
                  selectedPath={selectedPath} 
                  onSelect={(node) => selectFileByPath(node.path)}
                  onCreateFile={handleCreateFile}
                  onCreateFolder={handleCreateFolder}
                  onRenameFile={handleRenameFile}
                  onDeleteFile={handleDeleteFile}
                  onDuplicateFile={handleDuplicateFile}
                />
              ))
            )}
          </div>
        </div>

        <div className="project-right">
          <div className="project-tabs">
            {openTabs.length > 0 && (
              <div className="project-file-tabs">
                {openTabs.map((path) => (
                  <button
                    key={path}
                    className={`project-file-tab${selectedPath === path ? " project-file-tab--active" : ""}`}
                    onClick={() => selectFileByPath(path)}
                    title={path}
                  >
                    <FileDot name={path} />
                    <span>{getFileName(path)}</span>
                    {editedFiles[path] !== undefined && <b title="Unsaved changes">*</b>}
                    <i
                      role="button"
                      tabIndex={0}
                      title="Close tab"
                      aria-label={`Close ${getFileName(path)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(path);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          closeTab(path);
                        }
                      }}
                    >
                      x
                    </i>
                  </button>
                ))}
              </div>
            )}
            <button className={`project-tab${activeTab === "code" ? " project-tab--active" : ""}`} onClick={() => setActiveTab("code")}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M3 3L1 5.5L3 8M8 3L10 5.5L8 8M6 2L5 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Code
            </button>
            <button className={`project-tab${activeTab === "preview" ? " project-tab--active" : ""}`} onClick={() => setActiveTab("preview")}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <rect x="1" y="1.5" width="9" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
                <circle cx="5.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1" />
              </svg>
              Preview
              {getPreviewUrl() && <span className="tab-pulse" style={{ background: "#4caf7d" }} />}
            </button>
            <button className={`project-tab${activeTab === "terminal" ? " project-tab--active" : ""}`} onClick={() => setActiveTab("terminal")}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <rect x="1" y="1" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1" />
                <path d="M3 4L5 5.5L3 7M6 7H8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Terminal
              {isGenerating && <span className="tab-pulse" />}
            </button>
            <button className={`project-tab${activeTab === "source" ? " project-tab--active" : ""}`} onClick={() => setActiveTab("source")}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <circle cx="3" cy="2.5" r="1.2" stroke="currentColor" strokeWidth="1" />
                <circle cx="8" cy="8.5" r="1.2" stroke="currentColor" strokeWidth="1" />
                <path d="M3 3.8v1.4c0 1.1.9 2 2 2h1.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              </svg>
              Source
              {!workingTreeStatus.clean && <span className="tab-count">{workingTreeStatus.changedFiles.length}</span>}
            </button>
            <button className={`project-tab${activeTab === "deploy" ? " project-tab--active" : ""}`} onClick={() => setActiveTab("deploy")}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M5.5 1.2v6M3.2 3.4l2.3-2.2 2.3 2.2M2 8.8h7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Deploy
              <span className="tab-pulse" style={{ background: deploymentPreflight.ready ? "#4caf7d" : "#e05c5c" }} />
            </button>
          </div>

          <div className={`project-content${splitPreview ? " project-content--split" : ""}`}>
            {(activeTab === "code" || splitPreview) && (
              <CodeViewer
                file={selectedFile}
                files={effectiveFiles}
                content={selectedContent}
                onChange={(next) => selectedFile && handleUpdateFile(selectedFile.path, next)}
                onSave={handleSaveFile}
                onReset={handleResetFile}
                onFilesChange={onFilesChange}
                onSelectFile={selectFileByPath}
                isModified={isModified}
              />
            )}
            {(activeTab === "preview" || splitPreview) && <LivePreviewTab files={effectiveFiles} />}
            {activeTab === "terminal" && !splitPreview && <Terminal logs={logs} isGenerating={isGenerating} />}
            {activeTab === "source" && !splitPreview && (
              <SourceControlPanel
                status={workingTreeStatus}
                checkpoints={checkpoints}
                checkpointMessage={checkpointMessage}
                onMessageChange={setCheckpointMessage}
                onCreateCheckpoint={handleCreateCheckpoint}
                onRestoreCheckpoint={handleRestoreCheckpoint}
                onDeleteCheckpoint={handleDeleteCheckpoint}
                onSelectFile={selectFileByPath}
                githubStatus={githubStatus}
                githubRepos={githubRepos}
                githubBranches={githubBranches}
                selectedRepo={selectedGithubRepo}
                selectedBaseBranch={selectedGithubBaseBranch}
                branchName={githubBranchName}
                githubBusy={githubBusy}
                githubError={githubError}
                githubPrResult={githubPrResult}
                onSelectedRepoChange={handleSelectedGithubRepoChange}
                onBaseBranchChange={setSelectedGithubBaseBranch}
                onBranchNameChange={setGithubBranchName}
                onConnectSourceControl={handleConnectSourceControl}
                onRefreshGitHub={refreshGitHub}
                onCreatePullRequest={handleCreateGitHubPullRequest}
              />
            )}
            {activeTab === "deploy" && !splitPreview && (
              <DeployWorkflowPanel
                preflight={deploymentPreflight}
                deploying={deploying}
                deployResult={deployResult}
                deployError={deployError}
                deploymentHistory={deploymentHistory}
                onDeploy={handleDeploy}
                onRefreshHistory={refreshDeploymentHistory}
              />
            )}
          </div>
        </div>
      </div>
      {showQuickOpen && (
        <QuickOpenDialog
          files={flatFiles}
          onSelect={selectFileByPath}
          onClose={() => setShowQuickOpen(false)}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          commands={commandItems}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
    </div>
  );
}
