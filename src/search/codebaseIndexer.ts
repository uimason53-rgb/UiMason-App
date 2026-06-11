// ─────────────────────────────────────────────────────────────
// codebaseIndexer.ts
// Builds a structural map of a generated project for targeted
// editing. Cached and rebuilt only when files change.
// ─────────────────────────────────────────────────────────────

import type { GeneratedFile } from "../services/claudeService";

export type IndexedFile = {
  path: string;
  extension: string;
  imports: string[];
  exports: string[];
  symbols: string[]; // functions, classes, components
  isConfig: boolean;
  isEntry: boolean;
  summary: string; // first 200 chars
};

export type ComponentNode = {
  name: string;
  filePath: string;
  type: "page" | "component" | "layout" | "hook" | "service" | "util" | "unknown";
  imports: string[];
};

export type RouteNode = {
  path: string;
  file: string;
  component: string;
};

export type DependencyNode = {
  name: string;
  version: string;
  isDev: boolean;
};

export type CodebaseMap = {
  framework: string | null;
  files: IndexedFile[];
  components: ComponentNode[];
  routes: RouteNode[];
  dependencies: DependencyNode[];
  fileCount: number;
};

// ── Caching ──────────────────────────────────────────────────
let cachedMap: CodebaseMap | null = null;
let cachedFileCount = 0;

// ── Extract imports from file content ───────────────────────
const extractImports = (content: string): string[] => {
  const imports: string[] = [];
  const regex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)*\s*(?:from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
};

// ── Extract exports from file content ───────────────────────
const extractExports = (content: string): string[] => {
  const exports: string[] = [];
  const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  return exports;
};

// ── Extract symbols (components, functions, classes) ─────────
const extractSymbols = (content: string): string[] => {
  const symbols: string[] = [];
  // React components (function names starting with uppercase)
  const compRegex = /(?:export\s+)?(?:function|const)\s+([A-Z]\w*)/g;
  let match;
  while ((match = compRegex.exec(content)) !== null) {
    symbols.push(match[1]);
  }
  // Hooks
  const hookRegex = /(?:export\s+)?(?:function|const)\s+(use[A-Z]\w*)/g;
  while ((match = hookRegex.exec(content)) !== null) {
    if (!symbols.includes(match[1])) symbols.push(match[1]);
  }
  return symbols;
};

// ── Classify component type ─────────────────────────────────
const classifyComponent = (path: string): ComponentNode["type"] => {
  if (path.includes("/pages/") || path.includes("/app/")) return "page";
  if (path.includes("/components/")) return "component";
  if (path.includes("/layout") || path.includes("Layout")) return "layout";
  if (path.includes("/hooks/") || path.includes("use")) return "hook";
  if (path.includes("/services/") || path.includes("/api/")) return "service";
  if (path.includes("/utils/") || path.includes("/lib/")) return "util";
  return "unknown";
};

// ── Detect framework ────────────────────────────────────────
const detectFramework = (files: GeneratedFile[]): string | null => {
  const paths = files.map((f) => f.path.toLowerCase());
  const allContent = files.map((f) => f.content || "").join(" ").toLowerCase();

  if (paths.some((p) => p.includes("next.config"))) return "nextjs";
  if (allContent.includes("from \"react\"") || allContent.includes("from 'react'")) return "react";
  if (paths.some((p) => p.endsWith(".vue"))) return "vue";
  if (paths.some((p) => p.endsWith(".svelte"))) return "svelte";
  if (paths.some((p) => p.endsWith("angular.json") || p.includes(".component.ts"))) return "angular";
  return null;
};

// ── Extract routes from Next.js/React Router files ──────────
const extractRoutes = (files: GeneratedFile[]): RouteNode[] => {
  const routes: RouteNode[] = [];
  for (const file of files) {
    const content = file.content || "";
    // Next.js app router (file-based)
    const nextPage = file.path.match(/app\/(.+)\/page\.(tsx|jsx|ts|js)$/);
    if (nextPage) {
      routes.push({ path: `/${nextPage[1]}`, file: file.path, component: "page" });
    }
    // React Router <Route path="..." component={X} />
    const rrRegex = /<Route\s+path=["']([^"']+)["'][^>]*component=\{(\w+)\}/g;
    let match;
    while ((match = rrRegex.exec(content)) !== null) {
      routes.push({ path: match[1], file: file.path, component: match[2] });
    }
  }
  return routes;
};

// ── Extract dependencies from package.json ──────────────────
const extractDependencies = (files: GeneratedFile[]): DependencyNode[] => {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return [];
  try {
    const pkgJson = JSON.parse(pkg.content || "{}");
    const deps: DependencyNode[] = [];
    for (const [name, version] of Object.entries(pkgJson.dependencies || {})) {
      deps.push({ name, version: version as string, isDev: false });
    }
    for (const [name, version] of Object.entries(pkgJson.devDependencies || {})) {
      deps.push({ name, version: version as string, isDev: true });
    }
    return deps;
  } catch {
    return [];
  }
};

// ── MAIN: Build codebase map ────────────────────────────────
export const buildCodebaseMap = (files: GeneratedFile[]): CodebaseMap => {
  // Return cached if file count unchanged
  if (cachedMap && cachedFileCount === files.length) return cachedMap;

  const indexedFiles: IndexedFile[] = [];
  const components: ComponentNode[] = [];

  for (const file of files) {
    const content = file.content || "";
    const imports = extractImports(content);
    const exports = extractExports(content);
    const symbols = extractSymbols(content);

    indexedFiles.push({
      path: file.path,
      extension: file.path.split(".").pop() || "",
      imports,
      exports,
      symbols,
      isConfig: file.path.endsWith("config.js") || file.path.endsWith("config.ts") || file.path === "package.json" || file.path === "tsconfig.json",
      isEntry: file.path === "src/main.tsx" || file.path === "src/index.tsx" || file.path === "src/index.js" || file.path === "index.html",
      summary: content.slice(0, 200),
    });

    for (const sym of symbols) {
      components.push({
        name: sym,
        filePath: file.path,
        type: classifyComponent(file.path),
        imports,
      });
    }
  }

  const map: CodebaseMap = {
    framework: detectFramework(files),
    files: indexedFiles,
    components,
    routes: extractRoutes(files),
    dependencies: extractDependencies(files),
    fileCount: files.length,
  };

  cachedMap = map;
  cachedFileCount = files.length;
  return map;
};

// ── Generate architecture summary for context ────────────────
export const generateArchitectureSummary = (map: CodebaseMap): string => {
  const lines: string[] = [];

  lines.push(`**Framework:** ${map.framework || "Unknown"}`);
  lines.push(`**Files:** ${map.fileCount}`);
  lines.push(`**Components:** ${map.components.length}`);
  lines.push(`**Routes:** ${map.routes.length}`);
  lines.push(`**Dependencies:** ${map.dependencies.length}`);

  if (map.components.length > 0) {
    const byType: Record<string, string[]> = {};
    for (const c of map.components) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(`${c.name} (${c.filePath})`);
    }
    for (const [type, items] of Object.entries(byType)) {
      lines.push(`\n${type}s:`);
      for (const item of items.slice(0, 10)) lines.push(`  - ${item}`);
      if (items.length > 10) lines.push(`  ... +${items.length - 10} more`);
    }
  }

  if (map.routes.length > 0) {
    lines.push(`\nRoutes:`);
    for (const r of map.routes.slice(0, 10)) {
      lines.push(`  - ${r.path} → ${r.component} (${r.file})`);
    }
  }

  return lines.join("\n");
};