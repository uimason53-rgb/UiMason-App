// ─────────────────────────────────────────────────────────────
// relevantFiles.ts
// Given a user prompt and codebase map, returns the most
// relevant files for targeted editing. Uses keyword matching
// and structural analysis to find related files.
// ─────────────────────────────────────────────────────────────

import type { CodebaseMap, IndexedFile } from "./codebaseIndexer";

export type RelevantFileResult = {
  path: string;
  relevance: number; // 0-1
  reason: string;
};

// ── Expand user intent into search keywords ─────────────────
const extractIntentKeywords = (prompt: string): string[] => {
  const p = prompt.toLowerCase();
  const keywords: string[] = [];

  // Intent mappings: common phrases → likely file keywords
  const intentMap: Record<string, string[]> = {
    // Auth
    auth: ["auth" , "login", "signup", "register", "session", "token", "jwt", "oauth", "user"],
    login: ["login", "auth", "signin", "session"],
    register: ["register", "signup", "auth"],
    // Payments
    stripe: ["stripe", "payment", "checkout", "billing", "subscription", "price", "invoice", "plan"],
    payment: ["payment", "stripe", "checkout", "billing"],
    checkout: ["checkout", "cart", "payment", "stripe"],
    billing: ["billing", "invoice", "price", "plan", "subscription"],
    // Landing/home
    landing: ["landing", "hero", "home", "index", "page"],
    home: ["home", "index", "landing", "hero"],
    hero: ["hero", "landing", "header", "home"],
    // Dashboard
    dashboard: ["dashboard", "admin", "panel", "analytics", "stats", "chart"],
    admin: ["admin", "dashboard", "panel", "manage"],
    // Settings
    settings: ["settings", "config", "preferences", "profile", "account"],
    profile: ["profile", "settings", "account", "user"],
    // Navigation
    nav: ["nav", "navbar", "header", "sidebar", "menu", "navigation"],
    sidebar: ["sidebar", "nav", "menu", "layout"],
    header: ["header", "nav", "navbar"],
    footer: ["footer", "layout"],
    // Styling
    style: ["style", "css", "theme", "dark", "tailwind", "design"],
    dark: ["dark", "theme", "style", "mode", "toggle"],
    theme: ["theme", "style", "dark", "colors", "tailwind"],
    // Features
    search: ["search", "filter", "query", "find"],
    chat: ["chat", "message", "socket", "websocket", "conversation"],
    form: ["form", "input", "validation", "submit"],
    api: ["api", "fetch", "axios", "service", "endpoint"],
    database: ["database", "db", "prisma", "supabase", "sql", "migrate"],
    deploy: ["deploy", "vercel", "netlify", "build", "ci"],
    test: ["test", "jest", "vitest", "spec"],
    // General
    upgrade: ["index", "main", "app", "package", "page", "component", "layout"],
    improve: ["index", "main", "app", "page", "component"],
    fix: ["index", "main", "app", "error", "page"],
    add: [],
    change: [],
  };

  for (const [intent, kwds] of Object.entries(intentMap)) {
    if (p.includes(intent)) {
      keywords.push(...kwds);
    }
  }

  // Always include direct words from prompt (3+ chars)
  const promptWords = p.split(/[\s,.:;!?]+/).filter((w) => w.length >= 3);
  keywords.push(...promptWords);

  return [...new Set(keywords)];
};

// ── Score a file against keywords ────────────────────────────
const scoreFile = (file: IndexedFile, keywords: string[]): { score: number; reason: string } => {
  let score = 0;
  const reasons: string[] = [];
  const fileName = file.path.toLowerCase();
  const content = file.summary.toLowerCase();

  for (const kw of keywords) {
    // Filename match (strong signal)
    if (fileName.includes(kw)) {
      score += 0.4;
      reasons.push(`filename matches "${kw}"`);
    }
    // Symbol match (exported component/function name)
    if (file.symbols.some((s) => s.toLowerCase().includes(kw))) {
      score += 0.35;
      reasons.push(`symbol matches "${kw}"`);
    }
    // Import match
    if (file.imports.some((imp) => imp.toLowerCase().includes(kw))) {
      score += 0.2;
      reasons.push(`imports "${kw}"`);
    }
    // Content match
    if (content.includes(kw)) {
      score += 0.15;
      reasons.push(`references "${kw}"`);
    }
  }

  // Boost for non-config, non-entry source files
  if (!file.isConfig && !file.isEntry) score *= 1.1;
  // Boost for component files
  if (fileName.includes("/components/") || fileName.includes("/pages/")) score *= 1.2;
  // Penalty for config/dotfiles
  if (file.isConfig) score *= 0.3;

  return { score: Math.min(score, 1), reason: reasons[0] || "keyword match" };
};

// ── Expand to dependency graph (files imported by matches) ──
const expandDependents = (
  matches: Map<string, { score: number; reason: string }>,
  allFiles: IndexedFile[],
  maxSize: number
): void => {
  const matchedPaths = new Set(matches.keys());
  const expanded = new Map<string, { score: number; reason: string }>();

  for (const file of allFiles) {
    if (matchedPaths.has(file.path)) continue;
    // Check if this file imports any of the matched files
    const imported = file.imports.filter((imp) => {
      return [...matchedPaths].some((mp) => {
        const mpBase = mp.replace(/\.[^.]+$/, ""); // remove extension
        const impBase = imp.replace(/^\.\//, ""); // clean relative paths
        return mpBase.includes(impBase) || impBase.includes(mpBase.split("/").pop() || "");
      });
    });

    if (imported.length > 0) {
      expanded.set(file.path, { score: 0.3, reason: `imports matched file` });
    }
  }

  const remaining = maxSize - matches.size;
  let added = 0;
  for (const [path, val] of expanded) {
    if (added >= remaining) break;
    matches.set(path, val);
    added++;
  }
};

// ── MAIN: Get relevant files ─────────────────────────────────
export const getRelevantFiles = (prompt: string, map: CodebaseMap, maxFiles = 15): RelevantFileResult[] => {
  const keywords = extractIntentKeywords(prompt);

  const scored = new Map<string, { score: number; reason: string }>();

  // Score all files
  for (const file of map.files) {
    const { score, reason } = scoreFile(file, keywords);
    if (score > 0.05) {
      scored.set(file.path, { score, reason });
    }
  }

  // Expand to dependents (files that import matched files)
  expandDependents(scored, map.files, maxFiles);

  // Sort by relevance, take top N
  const results: RelevantFileResult[] = [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, maxFiles)
    .map(([path, val]) => ({ path, relevance: val.score, reason: val.reason }));

  return results;
};

// ── Build a change plan from relevant files + prompt ────────
export type ChangePlanEntry = {
  path: string;
  action: "modify" | "create" | "delete";
  reason: string;
};

export const buildChangePlan = (
  prompt: string,
  existingFiles: { path: string; content: string }[],
  relevant: RelevantFileResult[]
): { filesToModify: string[]; filesToCreate: string[]; filesToDelete: string[]; changes: ChangePlanEntry[]; rationale: string[] } => {
  const existingPaths = new Set(existingFiles.map((f) => f.path));
  const filesToModify: string[] = [];
  const filesToCreate: string[] = [];
  const filesToDelete: string[] = [];
  const changes: ChangePlanEntry[] = [];
  const rationale: string[] = [];
  const pLower = prompt.toLowerCase();

  for (const r of relevant) {
    const exists = existingPaths.has(r.path);
    if (r.relevance > 0.3) {
      if (exists) {
        filesToModify.push(r.path);
        changes.push({ path: r.path, action: "modify", reason: r.reason });
      }
      // Don't auto-create — let the planner decide
    }
  }

  // Detect creation requests from prompt
  const creationPatterns: Record<string, string> = {
    "add page": "src/pages/",
    "new page": "src/pages/",
    "create page": "src/pages/",
    "add component": "src/components/",
    "new component": "src/components/",
    "create component": "src/components/",
    "add hook": "src/hooks/",
    "new hook": "src/hooks/",
    "add service": "src/services/",
    "new service": "src/services/",
  };

  for (const [pattern, dir] of Object.entries(creationPatterns)) {
    if (pLower.includes(pattern)) {
      rationale.push(`Detected ${pattern} intent → may create files in ${dir}`);
    }
  }

  if (filesToModify.length === 0) {
    rationale.push("No specific files matched — targeting core files for modification");
    // Fallback to entry files
    for (const f of existingFiles) {
      if (f.path === "src/App.tsx" || f.path === "src/main.tsx" || f.path === "src/App.jsx") {
        filesToModify.push(f.path);
        changes.push({ path: f.path, action: "modify", reason: "main entry point" });
      }
    }
  }

  return { filesToModify, filesToCreate, filesToDelete, changes, rationale };
};