import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import db from "../db/index";

export type SandboxFile = {
  path: string;
  content: string;
};

export type SandboxCommandName = "install" | "build" | "lint" | "test";
export type SandboxJobStatus = "queued" | "running" | "passed" | "failed" | "timeout" | "error";

export type SandboxCommandResult = {
  name: SandboxCommandName;
  command: string;
  args: string[];
  success: boolean;
  exitCode: number | null;
  duration: number;
  timedOut: boolean;
  stdout: string[];
  stderr: string[];
};

export type SandboxJobResult = {
  success: boolean;
  status: SandboxJobStatus;
  commands: SandboxCommandResult[];
  errors: string[];
  warnings: string[];
  allOutput: string;
  duration: number;
};

export type SandboxJobSnapshot = {
  id: string;
  userId: string;
  status: SandboxJobStatus;
  commands: SandboxCommandName[];
  result: SandboxJobResult | null;
  logs: string[];
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

type RunOptions = {
  commands?: SandboxCommandName[];
  timeoutMs?: number;
};

type JobListener = (event: SandboxStreamEvent) => void;

export type SandboxStreamEvent =
  | { type: "log"; jobId: string; line: string }
  | { type: "status"; jobId: string; status: SandboxJobStatus }
  | { type: "done"; jobId: string; result: SandboxJobResult };

const DEFAULT_COMMANDS: SandboxCommandName[] = ["install", "build", "lint", "test"];
const DEFAULT_TIMEOUT_MS = 120_000;
const JOB_ROOT = path.join(os.tmpdir(), "uimason-sandbox-jobs");
const MAX_OUTPUT_LINES = 1200;
const MAX_FILE_BYTES = 1024 * 1024;
const listeners = new Map<string, Set<JobListener>>();

const createId = () => `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const now = () => Date.now();
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const normalizeCommands = (commands?: SandboxCommandName[]) => {
  const allowed = new Set<SandboxCommandName>(DEFAULT_COMMANDS);
  const requested = commands?.filter((command) => allowed.has(command)) ?? DEFAULT_COMMANDS;
  return [...new Set(requested)];
};

const safeRelativePath = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) throw new Error(`Invalid file path: ${filePath}`);
  const resolved = path.resolve("/", normalized);
  if (resolved.includes("..")) throw new Error(`Unsafe file path: ${filePath}`);
  return normalized;
};

const getPackageScripts = (files: SandboxFile[]): Record<string, string> => {
  const pkg = files.find((file) => file.path.replace(/\\/g, "/") === "package.json");
  if (!pkg?.content) return {};
  try {
    const parsed = JSON.parse(pkg.content) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
};

const appendLimited = (target: string[], line: string) => {
  if (!line.trim()) return;
  target.push(line);
  if (target.length > MAX_OUTPUT_LINES) target.splice(0, target.length - MAX_OUTPUT_LINES);
};

const parseErrors = (output: string) => {
  const errors: string[] = [];
  const tsErr = output.match(/(?:error TS\d+:.+)/g);
  if (tsErr) errors.push(...tsErr);
  const lintErr = output.match(/(?:\d+:\d+\s+error\s+.+)/g);
  if (lintErr) errors.push(...lintErr);
  const generic = output.match(/(?:Error:|Failed|Cannot find|Module not found|ERR!|ELIFECYCLE).+/gi);
  if (generic) errors.push(...generic.map((line) => line.trim()));
  return [...new Set(errors)];
};

const parseWarnings = (output: string) => {
  const warnings = output.match(/(?:warning|warn).+/gi);
  return warnings ? [...new Set(warnings.map((line) => line.trim()))] : [];
};

const rowToSnapshot = (row: Record<string, unknown>): SandboxJobSnapshot => ({
  id: row.id as string,
  userId: row.userId as string,
  status: row.status as SandboxJobStatus,
  commands: JSON.parse((row.commands as string) || "[]") as SandboxCommandName[],
  result: row.result ? (JSON.parse(row.result as string) as SandboxJobResult) : null,
  logs: JSON.parse((row.logs as string) || "[]") as string[],
  workspacePath: row.workspacePath as string,
  createdAt: row.createdAt as number,
  updatedAt: row.updatedAt as number,
  completedAt: (row.completedAt as number | null) ?? null,
});

const persistLog = (jobId: string, line: string) => {
  const row = db.prepare("SELECT logs FROM sandbox_jobs WHERE id = ?").get(jobId) as { logs: string } | undefined;
  const logs = row ? (JSON.parse(row.logs || "[]") as string[]) : [];
  appendLimited(logs, line);
  db.prepare("UPDATE sandbox_jobs SET logs = ?, updatedAt = ? WHERE id = ?").run(JSON.stringify(logs), now(), jobId);
};

const emit = (event: SandboxStreamEvent) => {
  const subscribers = listeners.get(event.jobId);
  subscribers?.forEach((listener) => listener(event));
};

const logJob = (jobId: string, line: string) => {
  persistLog(jobId, line);
  emit({ type: "log", jobId, line });
};

const setStatus = (jobId: string, status: SandboxJobStatus) => {
  db.prepare("UPDATE sandbox_jobs SET status = ?, updatedAt = ? WHERE id = ?").run(status, now(), jobId);
  emit({ type: "status", jobId, status });
};

const writeWorkspace = async (workspacePath: string, files: SandboxFile[]) => {
  await mkdir(workspacePath, { recursive: true });
  for (const file of files) {
    const relative = safeRelativePath(file.path);
    const content = file.content ?? "";
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      throw new Error(`File too large for sandbox: ${relative}`);
    }

    const target = path.resolve(workspacePath, relative);
    if (!target.startsWith(workspacePath)) throw new Error(`Unsafe file path: ${file.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
};

const runCommand = (
  jobId: string,
  workspacePath: string,
  name: SandboxCommandName,
  command: string,
  args: string[],
  timeoutMs: number
): Promise<SandboxCommandResult> =>
  new Promise((resolve) => {
    const started = now();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let timedOut = false;

    logJob(jobId, `[${name}] ${command} ${args.join(" ")}`.trim());
    const child = spawn(command, args, {
      cwd: workspacePath,
      env: { ...process.env, CI: "true", npm_config_audit: "false", npm_config_fund: "false" },
      windowsHide: true,
      shell: false,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      logJob(jobId, `[${name}] timeout after ${Math.round(timeoutMs / 1000)}s`);
      child.kill("SIGTERM");
    }, timeoutMs);

    const collect = (chunk: Buffer, target: string[], prefix: string) => {
      chunk.toString().split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        appendLimited(target, line);
        logJob(jobId, `[${prefix}] ${line}`);
      });
    };

    child.stdout.on("data", (chunk: Buffer) => collect(chunk, stdout, name));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, stderr, `${name}:err`));
    child.on("error", (error) => {
      appendLimited(stderr, error.message);
      logJob(jobId, `[${name}:err] ${error.message}`);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        name,
        command,
        args,
        success: exitCode === 0 && !timedOut,
        exitCode,
        duration: now() - started,
        timedOut,
        stdout,
        stderr,
      });
    });
  });

const commandPlan = (
  requested: SandboxCommandName[],
  scripts: Record<string, string>
): Array<{ name: SandboxCommandName; command: string; args: string[]; skip?: string }> =>
  requested.map((name) => {
    if (name === "install") return { name, command: npmBin, args: ["install", "--no-audit", "--no-fund"] };
    if (!scripts[name]) return { name, command: npmBin, args: ["run", name], skip: `No ${name} script found` };
    return { name, command: npmBin, args: ["run", name] };
  });

const finishJob = async (jobId: string, result: SandboxJobResult, workspacePath: string) => {
  const completedAt = now();
  db.prepare(
    "UPDATE sandbox_jobs SET status = ?, result = ?, updatedAt = ?, completedAt = ? WHERE id = ?"
  ).run(result.status, JSON.stringify(result), completedAt, completedAt, jobId);
  emit({ type: "done", jobId, result });

  if (process.env.UIMASON_KEEP_SANDBOX_WORKSPACES !== "1") {
    await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  }
};

const executeJob = async (jobId: string, files: SandboxFile[], options: RunOptions, workspacePath: string) => {
  const started = now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requested = normalizeCommands(options.commands);
  const scripts = getPackageScripts(files);
  const results: SandboxCommandResult[] = [];
  const output: string[] = [];

  try {
    setStatus(jobId, "running");
    logJob(jobId, `[sandbox] Preparing isolated workspace ${workspacePath}`);
    await writeWorkspace(workspacePath, files);

    for (const step of commandPlan(requested, scripts)) {
      if (step.skip) {
        logJob(jobId, `[${step.name}] ${step.skip}; skipped`);
        continue;
      }

      const result = await runCommand(jobId, workspacePath, step.name, step.command, step.args, timeoutMs);
      results.push(result);
      output.push(`[${step.name}]`, ...result.stdout, ...result.stderr);
      if (!result.success) break;
    }

    const allOutput = output.join("\n");
    const errors = parseErrors(allOutput);
    if (results.some((result) => result.timedOut)) errors.push("Sandbox command timed out.");
    if (errors.length === 0) {
      const failed = results.find((result) => !result.success);
      if (failed) errors.push(...[...failed.stderr, ...failed.stdout].slice(-12));
    }

    const success = results.every((result) => result.success) && errors.length === 0;
    const status: SandboxJobStatus = results.some((result) => result.timedOut) ? "timeout" : success ? "passed" : "failed";
    await finishJob(jobId, {
      success,
      status,
      commands: results,
      errors: [...new Set(errors)].slice(0, 60),
      warnings: parseWarnings(allOutput).slice(0, 60),
      allOutput,
      duration: now() - started,
    }, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sandbox job failed";
    logJob(jobId, `[sandbox:err] ${message}`);
    await finishJob(jobId, {
      success: false,
      status: "error",
      commands: results,
      errors: [message],
      warnings: [],
      allOutput: output.join("\n"),
      duration: now() - started,
    }, workspacePath);
  }
};

export const createSandboxJob = (userId: string, files: SandboxFile[], options: RunOptions = {}) => {
  const id = createId();
  const createdAt = now();
  const commands = normalizeCommands(options.commands);
  const workspacePath = path.join(JOB_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, "_"), id);

  db.prepare(
    "INSERT INTO sandbox_jobs (id, userId, status, commands, logs, workspacePath, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id, userId, "queued", JSON.stringify(commands), "[]", workspacePath, createdAt, createdAt);

  setTimeout(() => void executeJob(id, files, { ...options, commands }, workspacePath), 0);
  return getSandboxJob(userId, id)!;
};

export const getSandboxJob = (userId: string, id: string): SandboxJobSnapshot | null => {
  const row = db.prepare("SELECT * FROM sandbox_jobs WHERE id = ? AND userId = ?").get(id, userId) as Record<string, unknown> | undefined;
  return row ? rowToSnapshot(row) : null;
};

export const subscribeSandboxJob = (jobId: string, listener: JobListener) => {
  const set = listeners.get(jobId) ?? new Set<JobListener>();
  set.add(listener);
  listeners.set(jobId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(jobId);
  };
};
