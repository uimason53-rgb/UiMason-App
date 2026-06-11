import type { GeneratedFile } from "./claudeService";

export type ValidationIssue = {
  filePath: string;
  line?: number;
  column?: number;
  severity: "error" | "warning";
  message: string;
  rule?: string;
};

export type ValidationResult = {
  totalFiles: number;
  totalIssues: number;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  passed: boolean;
  summary: string;
};

const checkSyntax = (files: GeneratedFile[]): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const file of files) {
    const content = file.content ?? "";
    if (!file.path.match(/\.(ts|tsx|js|jsx|css|html)$/)) continue;

    if (file.path.match(/\.(ts|tsx|js|jsx)$/)) {
      const ob = (content.match(/\{/g) || []).length;
      const cb = (content.match(/\}/g) || []).length;
      if (ob !== cb) issues.push({ filePath: file.path, severity: "error", message: `Unmatched braces: ${ob} open vs ${cb} close` });

      const op = (content.match(/\(/g) || []).length;
      const cp = (content.match(/\)/g) || []).length;
      if (op !== cp) issues.push({ filePath: file.path, severity: "error", message: `Unmatched parentheses: ${op} open vs ${cp} close` });
    }

    if (file.path.endsWith(".tsx") || file.path.endsWith(".jsx")) {
      const classAttrs = content.match(/class=/g);
      if (classAttrs) issues.push({ filePath: file.path, severity: "warning", message: `${classAttrs.length} "class=" should be "className" in JSX`, rule: "react/no-class-attribute" });
    }

    if (content.trim().length === 0 && !file.path.endsWith(".gitkeep")) {
      issues.push({ filePath: file.path, severity: "warning", message: "File is empty" });
    }
  }
  return issues;
};

const checkImports = (files: GeneratedFile[]): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const allPaths = new Set(files.map((f) => f.path));
  for (const file of files) {
    if (!file.path.match(/\.(ts|tsx|js|jsx)$/)) continue;
    const content = file.content ?? "";
    const importRegex = /from\s+['"]\.\.?\/[^'"]+['"]/g;
    const imports = content.match(importRegex) || [];
    for (const imp of imports) {
      const rawPath = imp.match(/['"]\.\.?\/[^'"]+['"]/)?.[0]?.replace(/['"]/g, "");
      if (!rawPath) continue;
      const baseDir = file.path.substring(0, file.path.lastIndexOf("/") || 0);
      const parts = rawPath.split("/");
      const resolved: string[] = baseDir ? baseDir.split("/") : [];
      for (const part of parts) {
        if (part === "..") resolved.pop();
        else if (part !== ".") resolved.push(part);
      }
      const base = resolved.join("/");
      const exists = [base, base + ".ts", base + ".tsx", base + ".js", base + ".jsx", base + "/index.ts", base + "/index.tsx"].some((p) => allPaths.has(p));
      if (!exists) issues.push({ filePath: file.path, severity: "warning", message: `Import "${rawPath}" may not resolve`, rule: "import/no-unresolved" });
    }
  }
  return issues;
};

export const verifyCode = (files: GeneratedFile[]): ValidationResult => {
  if (!files?.length) return { totalFiles: 0, totalIssues: 0, errors: 0, warnings: 0, issues: [], passed: true, summary: "No files." };
  const all = [...checkSyntax(files), ...checkImports(files)];
  const errors = all.filter((i) => i.severity === "error").length;
  const warnings = all.filter((i) => i.severity === "warning").length;
  return { totalFiles: files.length, totalIssues: all.length, errors, warnings, issues: all, passed: errors === 0, summary: errors === 0 ? `Passed (${warnings} warnings)` : `${errors} error(s), ${warnings} warning(s)` };
};

export const quickSanityCheck = (files: GeneratedFile[]): string | null => {
  const hasEntry = files.some((f) => ["index.html", "public/index.html", "src/main.tsx", "src/App.tsx"].includes(f.path));
  if (!hasEntry) return "No entry point found";
  const hasReact = files.some((f) => f.path.endsWith(".tsx") || f.path.endsWith(".jsx"));
  if (hasReact && !files.some((f) => f.path === "package.json")) return "React files but no package.json";
  if (!files.some((f) => f.path === "preview.html")) return "No preview.html";
  return null;
};