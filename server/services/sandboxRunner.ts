// server/services/sandboxRunner.ts
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "../db/client";
import { sandboxJobs } from "../db/schema";
import { eq, and } from "drizzle-orm";

export type SandboxFile = {
  path: string;
  content: string;
};

export type SandboxCommandName = "install" | "build" | "lint" | "test";
export type SandboxJobStatus = "queued" | "running" | "passed" | "failed" | "timeout" | "error" | "cancelled";
export type SandboxMode = "docker" | "local";

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
  failureSummary: string;
  resourceUsage: SandboxResourceUsage;
  policy: SandboxPolicy;
};

export type SandboxPolicy = {
  mode: SandboxMode;
  network: "install-only" | "host";
  installIgnoresScripts: boolean;
  timeoutMs: number;
  maxFiles: number;
  maxFileBytes: number;
  maxWorkspaceBytes: number;
  maxOutputLines: number;
  concurrency: number;
  dockerImage?: string;
};

export type SandboxResourceUsage = {
  fileCount: number;
  inputBytes: number;
  workspaceBytes: number;
  commandCount: number;
  timedOut: boolean;
  startedAt: number;
  completedAt?: number;
};

export type SandboxJobSnapshot = {
  id: string;
  userId: string;
  status: SandboxJobStatus;
  commands: SandboxCommandName[];
  result: SandboxJobResult | null;
  logs: string[];
  workspacePath: string;
  mode: SandboxMode;
  policy: SandboxPolicy;
  resourceUsage: SandboxResourceUsage | null;
  failureSummary: string;
  createdAt: number;
  startedAt: number | null;
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
const MAX_WORKSPACE_BYTES = Number(process.env.UIMASON_SANDBOX_MAX_WORKSPACE_BYTES ?? 40 * 1024 * 1024);
const MAX_FILES = Number(process.env.UIMASON_SANDBOX_MAX_FILES ?? 500);
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.UIMASON_SANDBOX_CONCURRENCY ?? 2));
const DOCKER_IMAGE = process.env.UIMASON_SANDBOX_DOCKER_IMAGE || "node:22-bookworm-slim";
const listeners = new Map<string, Set<JobListener>>();
const queue: Array<() => Promise<void>> = [];
const runningChildren = new Map<string, ChildProcessWithoutNullStreams>();
let activeJobs = 0;

const createId = () => `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const now = () => Date.now();
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const dockerBin = process.platform === "win32" ? "docker.exe" : "docker";

const getSandboxMode = (): SandboxMode => process.env.UIMASON_SANDBOX_MODE === "docker" ? "docker" : "local";

const buildPolicy = (timeoutMs: number): SandboxPolicy => {
  const mode = getSandboxMode();
  return {
    mode,
    network: mode === "docker" ? "install-only" : "host",
    installIgnoresScripts: mode !== "docker" || process.env.UIMASON_SANDBOX_IGNORE_NPM_SCRIPTS === "1",
    timeoutMs,
    maxFiles: MAX_FILES,
    maxFileBytes: MAX_FILE_BYTES,
    maxWorkspaceBytes: MAX_WORKSPACE_BYTES,
    maxOutputLines: MAX_OUTPUT_LINES,
    concurrency: MAX_CONCURRENT_JOBS,
    ...(mode === "docker" ? { dockerImage: DOCKER_IMAGE } : {}),
  };
};

const queueJob = (task: () => Promise<void>) => {
  queue.push(task);
  void drainQueue();
};

const drainQueue = async () => {
  while (activeJobs < MAX_CONCURRENT_JOBS && queue.length > 0) {
    const task = queue.shift()!;
    activeJobs += 1;
    task().finally(() => {
      activeJobs -= 1;
      void drainQueue();
    });
  }
};

const normalizeCommands = (commands?: SandboxCommandName[]) => {
  const allowed = new Set<SandboxCommandName>(DEFAULT_COMMANDS);
  const requested = commands?.filter((command) => allowed.has(command)) ?? DEFAULT_COMMANDS;
  return [...new Set(requested)];
};

const safeParseJson = <T>(value: unknown, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value as string) as T;
  } catch {
    return fallback;
  }
};

const safeRelativePath = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) throw new Error(`Invalid file path: ${filePath}`);
  if (/^(node_modules|\.git|\.env(?:\.|$)|dist|build|coverage)(\/|$)/i.test(normalized)) {
    throw new Error(`Sandbox rejected generated artifact or secret path: ${filePath}`);
  }
  const resolved = path.resolve("/", normalized);
  if (resolved.includes("..")) throw new Error(`Unsafe file path: ${filePath}`);
  return normalized;
};

const measureInput = (files: SandboxFile[]) => ({
  fileCount: files.length,
  inputBytes: files.reduce((total, file) => total + Buffer.byteLength(file.content ?? "", "utf8"), 0),
});

const measureDirBytes = async (dir: string): Promise<number> => {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await measureDirBytes(fullPath);
    } else {
      total += (await stat(fullPath).catch(() => ({ size: 0 }))).size;
    }
    if (total > MAX_WORKSPACE_BYTES) return total;
  }
  return total;
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

const assertSafePackageScripts = (scripts: Record<string, string>) => {
  const dangerous = [
    /\brm\s+-rf\s+(?:\/|\*)/i,
    /\bdel\s+\/[fsq]/i,
    /\bformat\b/i,
    /\bcurl\b.+\|\s*(?:sh|bash|powershell|pwsh)/i,
    /\bwget\b.+\|\s*(?:sh|bash|powershell|pwsh)/i,
    /\b(?:sudo|su)\b/i,
    /\b(?:shutdown|reboot)\b/i,
  ];
  for (const [name, script] of Object.entries(scripts)) {
    if (dangerous.some((pattern) => pattern.test(script))) {
      throw new Error(`Sandbox policy rejected suspicious package script "${name}".`);
    }
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

const summarizeFailure = (errors: string[], commands: SandboxCommandResult[]) => {
  const failed = commands.find((command) => !command.success);
  const head = failed ? `${failed.name} failed${failed.exitCode !== null ? ` with exit ${failed.exitCode}` : ""}` : "Sandbox failed";
  const detail = errors[0] ? `: ${errors[0]}` : "";
  return `${head}${detail}`.slice(0, 700);
};

const rowToSnapshot = (row: Record<string, unknown>): SandboxJobSnapshot => ({
  id: row.id as string,
  userId: row.userId as string,
  status: row.status as SandboxJobStatus,
  commands: safeParseJson((row.commands as string) || "[]", [] as SandboxCommandName[]),
  result: row.result ? safeParseJson(row.result as string, null as SandboxJobResult | null) : null,
  logs: safeParseJson((row.logs as string) || "[]", [] as string[]),
  workspacePath: row.workspacePath as string,
  mode: ((row.mode as string) || "local") as SandboxMode,
  policy: safeParseJson((row.policy as string) || "{}", buildPolicy(DEFAULT_TIMEOUT_MS)),
  resourceUsage: safeParseJson((row.resourceUsage as string) || "{}", null as SandboxResourceUsage | null),
  failureSummary: (row.failureSummary as string) || "",
  createdAt: row.createdAt as number,
  startedAt: (row.startedAt as number | null) ?? null,
  updatedAt: row.updatedAt as number,
  completedAt: (row.completedAt as number | null) ?? null,
});

// ── Async DB helpers (Drizzle / PostgreSQL) ──────────────────

const persistLog = async (jobId: string, line: string) => {
  const result = await db.select({ logs: sandboxJobs.logs }).from(sandboxJobs).where(eq(sandboxJobs.id, jobId)).limit(1);
  const logs = result[0] ? (JSON.parse(result[0].logs || "[]") as string[]) : [];
  appendLimited(logs, line);
  await db.update(sandboxJobs).set({ logs: JSON.stringify(logs), updatedAt: now() }).where(eq(sandboxJobs.id, jobId));
};

const emit = (event: SandboxStreamEvent) => {
  const subscribers = listeners.get(event.jobId);
  subscribers?.forEach((listener) => listener(event));
};

const logJob = async (jobId: string, line: string) => {
  await persistLog(jobId, line);
  emit({ type: "log", jobId, line });
};

const setStatus = async (jobId: string, status: SandboxJobStatus) => {
  await db.update(sandboxJobs).set({ status, updatedAt: now() }).where(eq(sandboxJobs.id, jobId));
  emit({ type: "status", jobId, status });
};

const getCurrentStatus = async (jobId: string): Promise<SandboxJobStatus | null> => {
  const result = await db.select({ status: sandboxJobs.status }).from(sandboxJobs).where(eq(sandboxJobs.id, jobId)).limit(1);
  return (result[0]?.status as SandboxJobStatus) ?? null;
};

const writeWorkspace = async (workspacePath: string, files: SandboxFile[]) => {
  if (files.length > MAX_FILES) throw new Error(`Too many files for sandbox: ${files.length}/${MAX_FILES}`);
  const input = measureInput(files);
  if (input.inputBytes > MAX_WORKSPACE_BYTES) {
    throw new Error(`Workspace too large for sandbox: ${input.inputBytes}/${MAX_WORKSPACE_BYTES} bytes`);
  }
  await mkdir(workspacePath, { recursive: true });
  for (const file of files) {
    const relative = safeRelativePath(file.path);
    const content = file.content ?? "";
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      throw new Error(`File too large for sandbox: ${relative}`);
    }
    const target = path.resolve(workspacePath, relative);
    const insideWorkspace = path.relative(workspacePath, target);
    if (insideWorkspace.startsWith("..") || path.isAbsolute(insideWorkspace)) throw new Error(`Unsafe file path: ${file.path}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
};

const scrubbedEnv = () => {
  const keep = ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "USERPROFILE", "TEMP", "TMP"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.CI = "true";
  env.NODE_ENV = "production";
  env.npm_config_audit = "false";
  env.npm_config_fund = "false";
  env.npm_config_progress = "false";
  return env;
};

const dockerArgsFor = (
  workspacePath: string,
  name: SandboxCommandName,
  command: string,
  args: string[],
  policy: SandboxPolicy
) => [
  "run", "--rm",
  "--cpus", process.env.UIMASON_SANDBOX_CPUS || "1",
  "--memory", process.env.UIMASON_SANDBOX_MEMORY || "768m",
  "--pids-limit", process.env.UIMASON_SANDBOX_PIDS || "256",
  "--network", name === "install" ? "bridge" : "none",
  "-e", "CI=true",
  "-e", "npm_config_audit=false",
  "-e", "npm_config_fund=false",
  "-e", "npm_config_progress=false",
  "-v", `${workspacePath}:/workspace`,
  "-w", "/workspace",
  policy.dockerImage || DOCKER_IMAGE,
  command === npmBin ? "npm" : command,
  ...args,
];

const runCommand = (
  jobId: string,
  workspacePath: string,
  name: SandboxCommandName,
  command: string,
  args: string[],
  timeoutMs: number,
  policy: SandboxPolicy
): Promise<SandboxCommandResult> =>
  new Promise((resolve) => {
    const started = now();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let timedOut = false;

    const executable = policy.mode === "docker" ? dockerBin : command;
    const finalArgs = policy.mode === "docker" ? dockerArgsFor(workspacePath, name, command, args, policy) : args;
    void logJob(jobId, `[${name}] ${command} ${args.join(" ")} (${policy.mode})`.trim());
    const child = spawn(executable, finalArgs, {
      cwd: workspacePath,
      env: scrubbedEnv(),
      windowsHide: true,
      shell: process.platform === "win32" && policy.mode === "local",
    });
    runningChildren.set(jobId, child);

    const timer = setTimeout(() => {
      timedOut = true;
      void logJob(jobId, `[${name}] timeout after ${Math.round(timeoutMs / 1000)}s`);
      void setStatus(jobId, "timeout");
      child.kill("SIGTERM");
    }, timeoutMs);

    const collect = (chunk: Buffer, target: string[], prefix: string) => {
      chunk.toString().split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        appendLimited(target, line);
        void logJob(jobId, `[${prefix}] ${line}`);
      });
    };

    child.stdout.on("data", (chunk: Buffer) => collect(chunk, stdout, name));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, stderr, `${name}:err`));
    child.on("error", (error) => {
      appendLimited(stderr, error.message);
      void logJob(jobId, `[${name}:err] ${error.message}`);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      runningChildren.delete(jobId);
      void getCurrentStatus(jobId).then((currentStatus) => {
        const cancelled = currentStatus === "cancelled";
        resolve({
          name, command, args,
          success: exitCode === 0 && !timedOut && !cancelled,
          exitCode,
          duration: now() - started,
          timedOut,
          stdout,
          stderr,
        });
      });
    });
  });

const commandPlan = (
  requested: SandboxCommandName[],
  scripts: Record<string, string>,
  policy: SandboxPolicy
): Array<{ name: SandboxCommandName; command: string; args: string[]; skip?: string }> =>
  requested.map((name) => {
    if (name === "install") {
      return {
        name,
        command: npmBin,
        args: ["install", "--no-audit", "--no-fund", ...(policy.installIgnoresScripts ? ["--ignore-scripts"] : [])],
      };
    }
    if (!scripts[name]) return { name, command: npmBin, args: ["run", name], skip: `No ${name} script found` };
    return { name, command: npmBin, args: ["run", name] };
  });

const finishJob = async (jobId: string, result: SandboxJobResult, workspacePath: string) => {
  const completedAt = now();
  await db.update(sandboxJobs).set({
    status: result.status,
    result: JSON.stringify(result),
    resourceUsage: JSON.stringify(result.resourceUsage),
    failureSummary: result.failureSummary,
    updatedAt: completedAt,
    completedAt,
  }).where(eq(sandboxJobs.id, jobId));
  emit({ type: "done", jobId, result });

  if (process.env.UIMASON_KEEP_SANDBOX_WORKSPACES !== "1") {
    await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  }
};

const executeJob = async (jobId: string, files: SandboxFile[], options: RunOptions, workspacePath: string) => {
  const started = now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policy = buildPolicy(timeoutMs);
  const requested = normalizeCommands(options.commands);
  const scripts = getPackageScripts(files);
  const results: SandboxCommandResult[] = [];
  const output: string[] = [];
  const input = measureInput(files);

  try {
    if (await getCurrentStatus(jobId) === "cancelled") {
      const resourceUsage: SandboxResourceUsage = {
        fileCount: input.fileCount, inputBytes: input.inputBytes,
        workspaceBytes: 0, commandCount: 0, timedOut: false,
        startedAt: started, completedAt: now(),
      };
      await finishJob(jobId, {
        success: false, status: "cancelled", commands: [],
        errors: ["Sandbox job cancelled before execution."],
        warnings: [], allOutput: "", duration: now() - started,
        failureSummary: "Sandbox job cancelled before execution.",
        resourceUsage, policy,
      }, workspacePath);
      return;
    }

    await db.update(sandboxJobs).set({
      startedAt: started,
      mode: policy.mode,
      policy: JSON.stringify(policy),
      resourceUsage: JSON.stringify({
        fileCount: input.fileCount, inputBytes: input.inputBytes,
        workspaceBytes: 0, commandCount: 0, timedOut: false, startedAt: started,
      } satisfies SandboxResourceUsage),
      updatedAt: started,
    }).where(eq(sandboxJobs.id, jobId));

    await setStatus(jobId, "running");
    await logJob(jobId, `[sandbox] Preparing isolated ${policy.mode} workspace ${workspacePath}`);
    await logJob(jobId, `[sandbox] Policy: timeout=${Math.round(timeoutMs / 1000)}s, files=${input.fileCount}/${MAX_FILES}, input=${input.inputBytes} bytes, maxWorkspace=${MAX_WORKSPACE_BYTES} bytes`);
    assertSafePackageScripts(scripts);
    await writeWorkspace(workspacePath, files);
    let workspaceBytes = await measureDirBytes(workspacePath);
    if (workspaceBytes > MAX_WORKSPACE_BYTES) throw new Error(`Workspace exceeded size limit before install: ${workspaceBytes}/${MAX_WORKSPACE_BYTES} bytes`);

    for (const step of commandPlan(requested, scripts, policy)) {
      if (await getCurrentStatus(jobId) === "cancelled") {
        await logJob(jobId, "[sandbox] Job cancelled before next command");
        break;
      }
      if (step.skip) {
        await logJob(jobId, `[${step.name}] ${step.skip}; skipped`);
        continue;
      }

      const result = await runCommand(jobId, workspacePath, step.name, step.command, step.args, timeoutMs, policy);
      results.push(result);
      output.push(`[${step.name}]`, ...result.stdout, ...result.stderr);
      workspaceBytes = await measureDirBytes(workspacePath);
      await db.update(sandboxJobs).set({
        resourceUsage: JSON.stringify({
          fileCount: input.fileCount, inputBytes: input.inputBytes,
          workspaceBytes, commandCount: results.length,
          timedOut: results.some((item) => item.timedOut),
          startedAt: started,
        } satisfies SandboxResourceUsage),
        updatedAt: now(),
      }).where(eq(sandboxJobs.id, jobId));

      if (workspaceBytes > MAX_WORKSPACE_BYTES) {
        await logJob(jobId, `[sandbox] workspace size limit exceeded: ${workspaceBytes}/${MAX_WORKSPACE_BYTES} bytes`);
        break;
      }
      if (!result.success) break;
    }

    const allOutput = output.join("\n");
    const errors = parseErrors(allOutput);
    if (results.some((result) => result.timedOut)) errors.push("Sandbox command timed out.");
    const finalWorkspaceBytes = await measureDirBytes(workspacePath);
    if (finalWorkspaceBytes > MAX_WORKSPACE_BYTES) errors.push(`Sandbox workspace size limit exceeded: ${finalWorkspaceBytes}/${MAX_WORKSPACE_BYTES} bytes.`);
    if (errors.length === 0) {
      const failed = results.find((result) => !result.success);
      if (failed) errors.push(...[...failed.stderr, ...failed.stdout].slice(-12));
    }

    const wasCancelled = await getCurrentStatus(jobId) === "cancelled";
    const success = !wasCancelled && results.every((result) => result.success) && errors.length === 0;
    const status: SandboxJobStatus = wasCancelled ? "cancelled" : results.some((result) => result.timedOut) ? "timeout" : success ? "passed" : "failed";
    const resourceUsage: SandboxResourceUsage = {
      fileCount: input.fileCount, inputBytes: input.inputBytes,
      workspaceBytes: finalWorkspaceBytes, commandCount: results.length,
      timedOut: results.some((result) => result.timedOut),
      startedAt: started, completedAt: now(),
    };
    const uniqueErrors = [...new Set(errors)].slice(0, 60);
    const failureSummary = success ? "" : summarizeFailure(uniqueErrors, results);
    await finishJob(jobId, {
      success, status, commands: results, errors: uniqueErrors,
      warnings: parseWarnings(allOutput).slice(0, 60),
      allOutput, duration: now() - started, failureSummary, resourceUsage, policy,
    }, workspacePath);

  } catch (error) {
    const message = error instanceof Error ? error.message : "Sandbox job failed";
    await logJob(jobId, `[sandbox:err] ${message}`);
    const resourceUsage: SandboxResourceUsage = {
      fileCount: input.fileCount, inputBytes: input.inputBytes,
      workspaceBytes: await measureDirBytes(workspacePath),
      commandCount: results.length,
      timedOut: results.some((result) => result.timedOut),
      startedAt: started, completedAt: now(),
    };
    await finishJob(jobId, {
      success: false, status: "error", commands: results,
      errors: [message], warnings: [],
      allOutput: output.join("\n"), duration: now() - started,
      failureSummary: summarizeFailure([message], results),
      resourceUsage, policy,
    }, workspacePath);
  }
};

export const createSandboxJob = async (userId: string, files: SandboxFile[], options: RunOptions = {}) => {
  const id = createId();
  const createdAt = now();
  const commands = normalizeCommands(options.commands);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policy = buildPolicy(timeoutMs);
  const input = measureInput(files);
  if (input.fileCount > MAX_FILES) throw new Error(`Too many files for sandbox: ${input.fileCount}/${MAX_FILES}`);
  if (input.inputBytes > MAX_WORKSPACE_BYTES) throw new Error(`Workspace too large for sandbox: ${input.inputBytes}/${MAX_WORKSPACE_BYTES} bytes`);
  const workspacePath = path.join(JOB_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, "_"), id);

  await db.insert(sandboxJobs).values({
    id, userId, status: "queued",
    commands: JSON.stringify(commands),
    logs: "[]", workspacePath,
    mode: policy.mode,
    policy: JSON.stringify(policy),
    resourceUsage: JSON.stringify({
      fileCount: input.fileCount, inputBytes: input.inputBytes,
      workspaceBytes: 0, commandCount: 0, timedOut: false, startedAt: 0,
    } satisfies SandboxResourceUsage),
    createdAt, updatedAt: createdAt,
  });

  queueJob(() => executeJob(id, files, { ...options, commands, timeoutMs }, workspacePath));
  return getSandboxJob(userId, id);
};

export const getSandboxJob = async (userId: string, id: string): Promise<SandboxJobSnapshot | null> => {
  const result = await db.select().from(sandboxJobs).where(and(eq(sandboxJobs.id, id), eq(sandboxJobs.userId, userId))).limit(1);
  return result[0] ? rowToSnapshot(result[0] as Record<string, unknown>) : null;
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

export const cancelSandboxJob = async (userId: string, id: string) => {
  const job = await getSandboxJob(userId, id);
  if (!job) return null;
  if (["passed", "failed", "timeout", "error", "cancelled"].includes(job.status)) return job;

  await setStatus(id, "cancelled");
  const child = runningChildren.get(id);
  child?.kill("SIGTERM");
  await logJob(id, "[sandbox] Cancellation requested");

  const cancelledAt = now();
  await db.update(sandboxJobs).set({ completedAt: cancelledAt, updatedAt: cancelledAt }).where(eq(sandboxJobs.id, id));
  return getSandboxJob(userId, id);
};

export const getSandboxWorkerStatus = () => ({
  mode: getSandboxMode(),
  activeJobs,
  queuedJobs: queue.length,
  concurrency: MAX_CONCURRENT_JOBS,
  jobRoot: JOB_ROOT,
  maxFiles: MAX_FILES,
  maxFileBytes: MAX_FILE_BYTES,
  maxWorkspaceBytes: MAX_WORKSPACE_BYTES,
  dockerImage: getSandboxMode() === "docker" ? DOCKER_IMAGE : undefined,
});