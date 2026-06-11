// ─────────────────────────────────────────────────────────────
// workspaceAnalysis.ts — Local workspace intelligence
// Pure functions for analyzing uploaded folder structures
// without any API calls. Framework detection, file listing,
// and AI prompt context builders.
// ─────────────────────────────────────────────────────────────

import type { Workspace, WorkspaceNode } from "../types/chat";
import type { GeneratedFile } from "../services/claudeService";

const TEXT_FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "json", "css", "scss", "sass", "html", "htm",
  "md", "mdx", "txt", "env", "yml", "yaml", "xml", "py", "java", "c",
  "cpp", "h", "hpp", "sh", "bash", "ps1", "toml", "ini", "cfg", "dockerfile", "gitignore",
  "svg",
]);

const isTextFile = (file: File): boolean => {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_FILE_EXTENSIONS.has(ext) || file.type.startsWith("text/");
};

const readTextFile = async (file: File): Promise<string | undefined> => {
  if (!isTextFile(file)) return undefined;
  try {
    return await file.text();
  } catch {
    return undefined;
  }
};

const parsePackageJson = (files: WorkspaceNode[]): { dependencySummary: string; scriptSummary: string } => {
  const pkg = files.find((f) => f.name === "package.json" && typeof f.content === "string");
  if (!pkg || !pkg.content) return { dependencySummary: "", scriptSummary: "" };

  try {
    const parsed = JSON.parse(pkg.content);
    const deps = Object.keys(parsed.dependencies ?? {}).slice(0, 6);
    const scripts = Object.keys(parsed.scripts ?? {}).slice(0, 6);
    return {
      dependencySummary: deps.length ? `• Dependencies: ${deps.join(", ")}\n` : "",
      scriptSummary: scripts.length ? `• Scripts: ${scripts.join(", ")}\n` : "",
    };
  } catch {
    return { dependencySummary: "", scriptSummary: "" };
  }
};

// Build a workspace tree from a FileList (folder upload)
export const buildWorkspaceTree = async (files: FileList): Promise<{ name: string; tree: WorkspaceNode[] }> => {
  const rootName = files[0].webkitRelativePath.split("/")[0];
  const nodeMap = new Map<string, WorkspaceNode>();
  const roots: WorkspaceNode[] = [];

  const ensureFolder = (path: string): WorkspaceNode => {
    if (nodeMap.has(path)) return nodeMap.get(path)!;
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const node: WorkspaceNode = { name, path, type: "folder", children: [] };
    nodeMap.set(path, node);
    if (parts.length === 1) {
      roots.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = ensureFolder(parentPath);
      parent.children!.push(node);
    }
    return node;
  };

  const filesWithContent = await Promise.all(
    Array.from(files).map(async (file) => ({
      file,
      relativePath: file.webkitRelativePath,
      content: await readTextFile(file),
    }))
  );

  filesWithContent.forEach(({ relativePath, content }) => {
    const parts = relativePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join("/");
      ensureFolder(folderPath);
    }

    const fileName = parts[parts.length - 1];
    const fileNode: WorkspaceNode = {
      name: fileName,
      path: relativePath,
      type: "file",
      content,
    };

    nodeMap.set(relativePath, fileNode);
    const parentPath = parts.slice(0, -1).join("/");
    const parent = nodeMap.get(parentPath);
    if (parent?.children) {
      parent.children.push(fileNode);
    }
  });

  return { name: rootName, tree: roots };
};

// Flatten WorkspaceNode tree → flat list of file nodes
export const flattenWorkspaceFiles = (nodes: WorkspaceNode[]): WorkspaceNode[] => {
  const files: WorkspaceNode[] = [];
  const walk = (ns: WorkspaceNode[]) => {
    for (const n of ns) {
      if (n.type === "file") files.push(n);
      else if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return files;
};

export const workspaceToGeneratedFiles = (workspace: Workspace): GeneratedFile[] =>
  flattenWorkspaceFiles(workspace.tree)
    .filter((f) => f.type === "file" && typeof f.content === "string" && f.content.length > 0)
    .map((f) => ({ path: f.path, content: f.content! }));

// Generate a smart local response from workspace tree (no API call)
export const generateWorkspaceResponse = (msg: string, workspace: Workspace): string => {
  const m = msg.toLowerCase();
  const flat = flattenWorkspaceFiles(workspace.tree);
  const names = flat.map((f) => f.name.toLowerCase());

  const hasReact = names.some((n) => n.match(/app\.(tsx|jsx)/) || n === "react");
  const hasVue = names.some((n) => n.endsWith(".vue"));
  const hasAngular = names.some((n) => n.endsWith(".component.ts"));
  const hasNext = names.some((n) => n.startsWith("next.config"));
  const hasCSS = names.some((n) => n.endsWith(".css") || n.endsWith(".scss"));
  const hasJS = names.some((n) => n.endsWith(".js") || n.endsWith(".ts"));
  const hasTW = names.some((n) => n.includes("tailwind"));
  const hasPkg = names.includes("package.json");
  const hasServer = names.some((n) => ["server.js", "server.ts", "app.js", "app.py", "main.py"].includes(n));

  const { dependencySummary, scriptSummary } = parsePackageJson(flat);

  let framework = "Static HTML / CSS / JS";
  if (hasNext) framework = "Next.js (React SSR)";
  else if (hasReact) framework = "React";
  else if (hasVue) framework = "Vue.js";
  else if (hasAngular) framework = "Angular";

  const fileList = flat.map((f) => `• \`${f.path || f.name}\``).join("\n");

  if (m.includes("framework") || m.includes("stack") || m.includes("guna apa")) {
    return (
      `**Tech Stack — ${workspace.name}**\n\n` +
      `• Framework: **${framework}**\n` +
      (hasTW ? "• CSS Framework: **Tailwind CSS**\n" : "") +
      (hasServer ? "• Backend: **Server file detected**\n" : "• Backend: Not detected (frontend only)\n") +
      (hasPkg ? "• Package: **package.json found**\n" : "") +
      dependencySummary +
      scriptSummary
    );
  }

  if (m.includes("file") || m.includes("senarai") || m.includes("list") || m.includes("tunjuk")) {
    return `**Files in workspace — ${workspace.name} (${flat.length} files)**\n\n${fileList}`;
  }

  return (
    `I've analyzed the active workspace **${workspace.name}**.\n\n` +
    `**Files found (${flat.length}):**\n${fileList}\n\n` +
    `**Project Summary:**\n` +
    `• Framework: **${framework}**\n` +
    (hasCSS ? "• CSS: Yes\n" : "") +
    (hasJS ? "• JavaScript/TypeScript: Yes\n" : "") +
    (hasServer ? "• Backend: Node.js/Python server detected\n" : "• Backend: Not detected\n") +
    (hasPkg ? "• Has package.json\n" : "") +
    (hasTW ? "• Uses Tailwind CSS\n" : "") +
    dependencySummary +
    scriptSummary +
    `\nI understand the project structure and I'm ready to help. What would you like to modify, improve, or build next?`
  );
};

// Build workspace context string for AI prompts
export const buildWorkspaceContext = (workspace: Workspace): string => {
  const flat = flattenWorkspaceFiles(workspace.tree);
  const fileList = flat.map((f) => `  - ${f.path || f.name}`).join("\n");
  const { dependencySummary, scriptSummary } = parsePackageJson(flat);

  return (
    `[ACTIVE WORKSPACE: ${workspace.name}]\n` +
    `${dependencySummary}${scriptSummary}` +
    `File structure (${flat.length} files):\n${fileList}\n` +
    `The user is working on this existing project. Respond with awareness of this project.`
  );
};