import type { GeneratedFile } from "./claudeService";
import { autoDetectTarget, type DeployConfig } from "./deployService";
import { generateCommitMessage, generateDiff, generateDiffSummary, type GitDiff } from "./gitService";
import { quickSanityCheck, verifyCode, type ValidationResult } from "./verificationEngine";

export type CheckpointKind = "manual" | "agent" | "deploy";

export type ProjectCheckpoint = {
  id: string;
  projectName: string;
  message: string;
  kind: CheckpointKind;
  files: GeneratedFile[];
  diffs: GitDiff[];
  summary: string;
  fingerprint: string;
  fileCount: number;
  createdAt: number;
  parentId?: string;
  deployConfig: DeployConfig;
  verification: ValidationResult;
};

export type WorkingTreeStatus = {
  baseCheckpoint?: ProjectCheckpoint;
  diffs: GitDiff[];
  summary: string;
  changedFiles: GitDiff[];
  additions: number;
  deletions: number;
  clean: boolean;
  suggestedCommitMessage: string;
};

export type DeploymentPreflight = {
  ready: boolean;
  config: DeployConfig;
  verification: ValidationResult;
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "warning" | "fail";
    detail: string;
  }>;
};

const CHECKPOINT_KEY = "uimason_project_checkpoints";
const MAX_CHECKPOINTS_PER_PROJECT = 40;

const createId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;

const normalizeProjectName = (projectName: string) =>
  projectName.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "project";

const hashString = (input: string) => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export const fingerprintFiles = (files: GeneratedFile[]) =>
  hashString(
    files
      .map((file) => `${file.path}:${hashString(file.content ?? "")}:${file.content?.length ?? 0}`)
      .sort()
      .join("|")
  );

const safeFiles = (files: GeneratedFile[]): GeneratedFile[] =>
  files
    .map((file) => ({ path: file.path, content: file.content ?? "" }))
    .sort((a, b) => a.path.localeCompare(b.path));

const loadAllCheckpoints = (): ProjectCheckpoint[] => {
  try {
    return JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || "[]") as ProjectCheckpoint[];
  } catch {
    return [];
  }
};

const saveAllCheckpoints = (checkpoints: ProjectCheckpoint[]) => {
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoints));
  } catch (error) {
    console.warn("Failed to save project checkpoints", error);
  }
};

export const getProjectCheckpoints = (projectName: string): ProjectCheckpoint[] => {
  const normalized = normalizeProjectName(projectName);
  return loadAllCheckpoints()
    .filter((checkpoint) => normalizeProjectName(checkpoint.projectName) === normalized)
    .sort((a, b) => b.createdAt - a.createdAt);
};

export const getLatestCheckpoint = (projectName: string): ProjectCheckpoint | undefined =>
  getProjectCheckpoints(projectName)[0];

export const getWorkingTreeStatus = (
  projectName: string,
  files: GeneratedFile[],
  prompt = "Update project"
): WorkingTreeStatus => {
  const baseCheckpoint = getLatestCheckpoint(projectName);
  const baseFiles = baseCheckpoint?.files ?? [];
  const diffs = generateDiff(baseFiles, safeFiles(files));
  const changedFiles = diffs.filter((diff) => diff.status !== "unchanged");
  const additions = changedFiles.reduce((sum, diff) => sum + diff.additions, 0);
  const deletions = changedFiles.reduce((sum, diff) => sum + diff.deletions, 0);

  return {
    baseCheckpoint,
    diffs,
    changedFiles,
    additions,
    deletions,
    clean: changedFiles.length === 0,
    summary: generateDiffSummary(changedFiles.length ? changedFiles : diffs),
    suggestedCommitMessage: generateCommitMessage(changedFiles, prompt),
  };
};

export const createCheckpoint = (
  projectName: string,
  files: GeneratedFile[],
  message: string,
  kind: CheckpointKind = "manual"
): ProjectCheckpoint => {
  const normalizedFiles = safeFiles(files);
  const existing = getProjectCheckpoints(projectName);
  const parent = existing[0];
  const diffs = generateDiff(parent?.files ?? [], normalizedFiles).filter((diff) => diff.status !== "unchanged");
  const checkpoint: ProjectCheckpoint = {
    id: createId("checkpoint"),
    projectName,
    message: message.trim() || generateCommitMessage(diffs, "Update project").split("\n")[0],
    kind,
    files: normalizedFiles,
    diffs,
    summary: generateDiffSummary(diffs),
    fingerprint: fingerprintFiles(normalizedFiles),
    fileCount: normalizedFiles.length,
    createdAt: Date.now(),
    parentId: parent?.id,
    deployConfig: autoDetectTarget(normalizedFiles),
    verification: verifyCode(normalizedFiles),
  };

  const others = loadAllCheckpoints().filter(
    (item) => normalizeProjectName(item.projectName) !== normalizeProjectName(projectName)
  );
  saveAllCheckpoints([...others, checkpoint, ...existing].slice(0, others.length + MAX_CHECKPOINTS_PER_PROJECT));
  return checkpoint;
};

export const deleteCheckpoint = (projectName: string, checkpointId: string) => {
  const normalized = normalizeProjectName(projectName);
  saveAllCheckpoints(
    loadAllCheckpoints().filter(
      (checkpoint) => normalizeProjectName(checkpoint.projectName) !== normalized || checkpoint.id !== checkpointId
    )
  );
};

export const analyzeDeploymentPreflight = (files: GeneratedFile[]): DeploymentPreflight => {
  const config = autoDetectTarget(files);
  const verification = verifyCode(files);
  const sanity = quickSanityCheck(files);
  const paths = new Set(files.map((file) => file.path));
  const packageFile = files.find((file) => file.path === "package.json");
  let packageJson: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  let packageParseError = "";

  if (packageFile) {
    try {
      packageJson = JSON.parse(packageFile.content ?? "{}");
    } catch (error) {
      packageParseError = error instanceof Error ? error.message : "Invalid package.json";
    }
  }

  const hasBuildScript = Boolean(packageJson.scripts?.build) || !config.buildCommand;
  const secretFiles = files.filter((file) => /\.env($|\.)/i.test(file.path) && !/\.example$/i.test(file.path));
  const hasLockfile = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].some((path) => paths.has(path));
  const checks: DeploymentPreflight["checks"] = [
    {
      id: "verification",
      label: "Static verification",
      status: verification.errors > 0 ? "fail" : verification.warnings > 0 ? "warning" : "pass",
      detail: verification.summary,
    },
    {
      id: "entry",
      label: "Entry point",
      status: sanity && sanity !== "No preview.html" ? "fail" : "pass",
      detail: sanity && sanity !== "No preview.html" ? sanity : "Entry point detected",
    },
    {
      id: "package",
      label: "Package metadata",
      status: packageParseError ? "fail" : packageFile ? "pass" : config.framework === "static" ? "pass" : "warning",
      detail: packageParseError || (packageFile ? "package.json available" : "No package.json found"),
    },
    {
      id: "build",
      label: "Build command",
      status: hasBuildScript ? "pass" : "fail",
      detail: hasBuildScript ? config.buildCommand || "Static deploy" : `Missing package.json script for ${config.buildCommand}`,
    },
    {
      id: "lockfile",
      label: "Dependency lockfile",
      status: hasLockfile || !packageFile ? "pass" : "warning",
      detail: hasLockfile ? "Lockfile available" : "No lockfile; deploy may resolve newer dependencies",
    },
    {
      id: "secrets",
      label: "Secret files",
      status: secretFiles.length > 0 ? "fail" : "pass",
      detail: secretFiles.length > 0 ? `Do not deploy ${secretFiles.map((file) => file.path).join(", ")}` : "No raw .env files detected",
    },
  ];

  return {
    ready: checks.every((check) => check.status !== "fail"),
    config,
    verification,
    checks,
  };
};
