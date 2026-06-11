// ─────────────────────────────────────────────────────────────
// deployService.ts
// One-click deployment to Vercel & Netlify via backend API
// Backend handles provider communication; frontend only calls
// internal endpoints.
// ─────────────────────────────────────────────────────────────

import type { GeneratedFile } from "./claudeService";
import { getAuthToken } from "../hooks/useSessionManager";

export type DeployTarget = "vercel" | "netlify" | "cloudflare" | "github-pages";
export type DeployStatus = "idle" | "uploading" | "deploying" | "live" | "error";

export type DeployConfig = {
  target: DeployTarget;
  projectName: string;
  buildCommand: string;
  outputDir: string;
  framework: string;
  envVars: Record<string, string>;
};

export type DeployResult = {
  success: boolean;
  url: string;
  deploymentId: string;
  provider: string;
  status: DeployStatus;
  logs: string[];
};

export type DeploymentRecord = {
  id: string;
  projectName: string;
  provider: string;
  deploymentUrl: string;
  status: string;
  createdAt: number;
};

// ── Auto-detect deploy config from project files ────────────
export const autoDetectTarget = (files: GeneratedFile[]): DeployConfig => {
  const paths = files.map((f) => f.path.toLowerCase());
  const allContent = files.map((f) => (f.content ?? "").toLowerCase()).join(" ");

  const config: DeployConfig = {
    target: "vercel",
    projectName: "my-app",
    buildCommand: "npm run build",
    outputDir: "dist",
    framework: "static",
    envVars: {},
  };

  if (paths.some((p) => p.includes("next.config"))) {
    config.target = "vercel"; config.framework = "nextjs";
    config.buildCommand = "next build"; config.outputDir = ".next";
  } else if (allContent.includes("from \"react\"") || paths.some((p) => p.endsWith(".tsx"))) {
    config.target = "vercel"; config.framework = "react-vite";
    config.buildCommand = "npm run build"; config.outputDir = "dist";
  } else if (paths.some((p) => p.endsWith(".vue"))) {
    config.target = "netlify"; config.framework = "vue";
    config.buildCommand = "npm run build"; config.outputDir = "dist";
  } else {
    config.target = "vercel"; config.framework = "static";
    config.buildCommand = ""; config.outputDir = ".";
  }

  const pkgFile = files.find((f) => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content ?? "{}");
      if (pkg.name) config.projectName = pkg.name;
    } catch (error) {
      console.warn("Failed to parse package.json for deploy detection", error);
    }
  }

  return config;
};

// ── Generate Vercel configuration ───────────────────────────
export const generateVercelConfig = (config: DeployConfig): GeneratedFile => ({
  path: "vercel.json",
  content: JSON.stringify({
    buildCommand: config.buildCommand || undefined,
    outputDirectory: config.outputDir,
    framework: config.framework === "nextjs" ? "nextjs" : undefined,
    installCommand: "npm install",
    env: Object.keys(config.envVars).reduce(
      (acc, k) => ({ ...acc, [k]: config.envVars[k] }),
      {}
    ),
  }, null, 2),
});

// ── Generate Netlify configuration ──────────────────────────
export const generateNetlifyConfig = (config: DeployConfig): GeneratedFile => ({
  path: "netlify.toml",
  content: [
    "[build]",
    `  command = "${config.buildCommand || "npm run build"}"`,
    `  publish = "${config.outputDir || "dist"}"`,
    "",
    "[build.environment]",
    ...Object.entries(config.envVars).map(([k, v]) => `  ${k} = "${v}"`),
  ].join("\n"),
});

// ── Generate deploy-ready files ─────────────────────────────
export const generateDeployFiles = (files: GeneratedFile[]): GeneratedFile[] => {
  const config = autoDetectTarget(files);
  const deployFiles: GeneratedFile[] = [];

  if (config.target === "vercel") {
    deployFiles.push(generateVercelConfig(config));
  } else if (config.target === "netlify") {
    deployFiles.push(generateNetlifyConfig(config));
  }

  if (!files.some((f) => f.path === ".gitignore")) {
    deployFiles.push({
      path: ".gitignore",
      content: "node_modules\ndist\n.env\n.env.local\n.DS_Store\n*.log\n",
    });
  }

  return deployFiles;
};

// ── Generate deploy summary text ────────────────────────────
export const generateDeploySummary = (config: DeployConfig, fileCount: number): string => {
  const commands: string[] = [];

  if (config.target === "vercel") {
    commands.push("1. Push to GitHub", "2. Import project at vercel.com/new", "3. Vercel auto-detects settings");
  } else if (config.target === "netlify") {
    commands.push("1. Push to GitHub", "2. Import at netlify.com", "3. Netlify reads netlify.toml");
  } else if (config.target === "cloudflare") {
    commands.push("1. Run `npx wrangler pages deploy dist`", "2. Or connect Git at dash.cloudflare.com");
  } else {
    commands.push("1. Build: `npm run build`", "2. Deploy output folder to hosting");
  }

  return [
    `**Deploy Ready — ${config.projectName}**`,
    `• Target: ${config.target}`,
    `• Framework: ${config.framework}`,
    `• Build: \`${config.buildCommand || "N/A (static)"}\``,
    `• Output: \`${config.outputDir}\``,
    `• Files: ${fileCount}`,
    "",
    "**Steps:**",
    ...commands,
  ].join("\n");
};

// ── One-click deploy via backend ────────────────────────────
const apiHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getAuthToken()}`,
});

export const deployToVercel = async (files: GeneratedFile[], projectName: string): Promise<DeployResult> => {
  const res = await fetch("/api/deploy/vercel", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ files, projectName }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Deploy failed" }));
    throw new Error(err.error || `Vercel deploy error: ${res.status}`);
  }

  return res.json();
};

export const deployToNetlify = async (files: GeneratedFile[], projectName: string): Promise<DeployResult> => {
  const res = await fetch("/api/deploy/netlify", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ files, projectName }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Deploy failed" }));
    throw new Error(err.error || `Netlify deploy error: ${res.status}`);
  }

  return res.json();
};

// ── Deploy history ──────────────────────────────────────────
export const getDeployments = async (): Promise<DeploymentRecord[]> => {
  const res = await fetch("/api/deployments", { headers: apiHeaders() });
  if (res.ok) return res.json();
  return [];
};

export const deleteDeployment = async (id: string): Promise<void> => {
  await fetch(`/api/deployments/${id}`, { method: "DELETE", headers: apiHeaders() });
};

// ── Smart deploy — auto-detect best provider ────────────────
export const smartDeploy = async (files: GeneratedFile[], projectName: string): Promise<DeployResult> => {
  const config = autoDetectTarget(files);
  if (config.target === "netlify") {
    return deployToNetlify(files, projectName);
  }
  return deployToVercel(files, projectName);
};