// ─────────────────────────────────────────────────────────────
// sandboxService.ts
// WebContainer sandbox — boot, mount, install, build, dev server
// Live preview via server-ready events + iframe embedding
// ─────────────────────────────────────────────────────────────
import { WebContainer, type FileSystemTree } from "@webcontainer/api";
import type { GeneratedFile } from "./claudeService";
import { emitBuildLog } from "./streamingService";
import { aiJsonHeaders, readApiError } from "./aiRuntime";

export type SandboxStatus = "booting" | "ready" | "installing" | "building" | "running" | "error" | "stopped";
export type CommandResult = { success: boolean; stdout: string[]; stderr: string[]; exitCode: number; duration: number };

let container: WebContainer | null = null;
let status: SandboxStatus = "stopped";
let previewUrl: string | null = null;
let devProcess: { kill: () => void } | null = null;

export const getPreviewUrl = (): string | null => previewUrl;
export const getSandboxStatus = (): SandboxStatus => status;

// ── Change listeners ───────────────────────────────────────
type StatusListener = (newStatus: SandboxStatus) => void;
type PreviewListener = (url: string | null) => void;

const statusListeners = new Set<StatusListener>();
const previewListeners = new Set<PreviewListener>();

export const onStatusChange = (fn: StatusListener) => { statusListeners.add(fn); return () => statusListeners.delete(fn); };
export const onPreviewUrl = (fn: PreviewListener) => { previewListeners.add(fn); return () => previewListeners.delete(fn); };

const setStatus = (s: SandboxStatus) => {
  status = s;
  statusListeners.forEach((fn) => fn(s));
};

const setPreviewUrl = (url: string | null) => {
  previewUrl = url;
  previewListeners.forEach((fn) => fn(url));
};

// ── Container lifecycle ────────────────────────────────────
export const getContainer = async (): Promise<WebContainer> => {
  if (container) return container;
  setStatus("booting");
  container = await WebContainer.boot();
  setStatus("ready");

  // Listen for server-ready events from WebContainer
  container.on("server-ready", (_port: number, url: string) => {
    setPreviewUrl(url);
    setStatus("running");
    emitBuildLog(`[server] Ready at ${url}`);
  });

  container.on("error", (err: { message: string }) => {
    setStatus("error");
    emitBuildLog(`[server] Error: ${err.message}`);
  });

  return container;
};

export const teardownContainer = async () => {
  if (devProcess) {
    devProcess.kill();
    devProcess = null;
  }
  if (container) {
    // WebContainer teardown is implicit when all references drop;
    // kill dev server process if running
    container = null;
  }
  setPreviewUrl(null);
  setStatus("stopped");
};

// ── Mount project files ────────────────────────────────────
export const mountProject = async (files: GeneratedFile[]): Promise<void> => {
  const c = await getContainer();
  const tree: FileSystemTree = {};
  for (const f of files) {
    const parts = f.path.split("/");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cur: any = tree;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) {
        cur[parts[i]] = { file: { contents: f.content ?? "" } };
      } else {
        if (!cur[parts[i]]) cur[parts[i]] = { directory: {} };
        cur = cur[parts[i]].directory;
      }
    }
  }
  await c.mount(tree);
};

// ── Execute commands ────────────────────────────────────────
export const executeCommand = async (cmd: string, args: string[] = []): Promise<CommandResult> => {
  const c = await getContainer();
  const t0 = Date.now();
  const out: string[] = [];
  const err: string[] = [];
  try {
    const p = await c.spawn(cmd, args);
    p.output.pipeTo(new WritableStream({ write(d) { out.push(d); } }));
    const code = await p.exit;
    return { success: code === 0, stdout: out, stderr: err, exitCode: code, duration: Date.now() - t0 };
  } catch (e) {
    return { success: false, stdout: out, stderr: [e instanceof Error ? e.message : "failed"], exitCode: 1, duration: Date.now() - t0 };
  }
};

export const npmInstall = () => executeCommand("npm", ["install", "--no-audit", "--no-fund"]);
export const npmBuild = () => executeCommand("npm", ["run", "build"]);
export const npmTest = () => executeCommand("npm", ["run", "test"]);
export const npmLint = () => executeCommand("npm", ["run", "lint"]);

const getPackageScripts = (files: GeneratedFile[]): Record<string, string> => {
  const pkg = files.find((file) => file.path === "package.json");
  if (!pkg?.content) return {};

  try {
    const parsed = JSON.parse(pkg.content) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
};

// ── Start dev server (live preview) ─────────────────────────
export const startDevServer = async (): Promise<boolean> => {
  const c = await getContainer();
  setStatus("running");

  // Kill existing dev process
  if (devProcess) {
    devProcess.kill();
    devProcess = null;
  }

  try {
    const process = await c.spawn("npm", ["run", "dev"]);
    devProcess = { kill: () => process.kill() };

    // Pipe stdout/stderr to build log
    process.output.pipeTo(
      new WritableStream({
        write(chunk: string) {
          emitBuildLog(`[dev] ${chunk}`);
        },
      })
    );

    // Don't await exit — dev server runs indefinitely
    process.exit.then((code: number) => {
      emitBuildLog(`[dev] Server exited with code ${code}`);
      if (code !== 0) setStatus("error");
    });

    return true;
  } catch (e) {
    emitBuildLog(`[dev] Failed to start: ${e instanceof Error ? e.message : "unknown"}`);
    setStatus("error");
    return false;
  }
};

export const stopDevServer = () => {
  if (devProcess) {
    devProcess.kill();
    devProcess = null;
  }
  setPreviewUrl(null);
  setStatus("ready");
};

// ── Parse build output ─────────────────────────────────────
export const parseBuildErrors = (r: CommandResult): string[] => {
  const all = [...r.stdout, ...r.stderr].join("\n");
  const errors: string[] = [];
  const tsErr = all.match(/(?:error TS\d+:.+)/g);
  if (tsErr) errors.push(...tsErr);
  const lintErr = all.match(/(?:\d+:\d+\s+error\s+.+)/g);
  if (lintErr) errors.push(...lintErr);
  const buildErr = all.match(/(?:Error:|Failed|Cannot find|Module not found).+/gi);
  if (buildErr) errors.push(...buildErr.map((e) => e.trim()));
  if (errors.length === 0 && !r.success) errors.push(...all.split("\n").filter((l) => l.trim()).slice(-5));
  return [...new Set(errors)];
};

export const parseBuildWarnings = (r: CommandResult): string[] => {
  const matches = [...r.stdout, ...r.stderr].join("\n").match(/(?:warning|warn).+/gi);
  return matches ? [...new Set(matches.map((w) => w.trim()))] : [];
};

export type BuildResult = {
  success: boolean;
  installResult: CommandResult | null;
  buildResult: CommandResult | null;
  lintResult: CommandResult | null;
  testResult: CommandResult | null;
  errors: string[];
  warnings: string[];
  allOutput: string;
  duration: number;
};

// ── Build pipeline (install + build + lint + test) ──────────
const runWebContainerBuildPipeline = async (files: GeneratedFile[]): Promise<BuildResult> => {
  const t0 = Date.now();
  const outputs: string[] = [];
  const scripts = getPackageScripts(files);

  setStatus("installing");
  emitBuildLog("[sandbox] Mounting project files...");
  await mountProject(files);

  setStatus("installing");
  emitBuildLog("[sandbox] Installing dependencies...");
  const install = await npmInstall();
  install.stdout.forEach((l) => emitBuildLog(`[npm] ${l}`));
  outputs.push("[npm install]", ...install.stdout);
  if (!install.success) {
    setStatus("error");
    return {
      success: false, installResult: install, buildResult: null, lintResult: null, testResult: null,
      errors: parseBuildErrors(install), warnings: [], allOutput: outputs.join("\n"), duration: Date.now() - t0,
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  let build: CommandResult | null = null;

  if (scripts.build) {
    setStatus("building");
    emitBuildLog("[sandbox] Building project...");
    build = await npmBuild();
    build.stdout.forEach((l) => emitBuildLog(`[build] ${l}`));
    build.stderr.forEach((l) => emitBuildLog(`[build:err] ${l}`));
    outputs.push("[npm run build]", ...build.stdout, ...build.stderr);
    errors.push(...parseBuildErrors(build));
    warnings.push(...parseBuildWarnings(build));
  } else {
    emitBuildLog("[sandbox] No build script found; skipping build step.");
    outputs.push("[npm run build skipped]");
  }

  let lint: CommandResult | null = null;
  if ((build?.success ?? true) && scripts.lint) {
    emitBuildLog("[sandbox] Linting project...");
    lint = await npmLint();
    lint.stdout.forEach((l) => emitBuildLog(`[lint] ${l}`));
    lint.stderr.forEach((l) => emitBuildLog(`[lint:err] ${l}`));
    outputs.push("[npm run lint]", ...lint.stdout, ...lint.stderr);
    errors.push(...parseBuildErrors(lint));
  } else if (!scripts.lint) {
    emitBuildLog("[sandbox] No lint script found; skipping lint step.");
    outputs.push("[npm run lint skipped]");
  }

  let test: CommandResult | null = null;
  if ((build?.success ?? true) && errors.length === 0 && scripts.test) {
    emitBuildLog("[sandbox] Running tests...");
    test = await npmTest();
    test.stdout.forEach((l) => emitBuildLog(`[test] ${l}`));
    test.stderr.forEach((l) => emitBuildLog(`[test:err] ${l}`));
    outputs.push("[npm run test]", ...test.stdout, ...test.stderr);
    errors.push(...parseBuildErrors(test));
  } else if (!scripts.test) {
    emitBuildLog("[sandbox] No test script found; skipping test step.");
    outputs.push("[npm run test skipped]");
  }

  const commandSuccess = (build?.success ?? true) && (lint?.success ?? true) && (test?.success ?? true);

  if (commandSuccess && errors.length === 0) {
    setStatus("ready");
  } else {
    setStatus("error");
  }

  return {
    success: commandSuccess && errors.length === 0,
    installResult: install, buildResult: build, lintResult: lint, testResult: test,
    errors, warnings, allOutput: outputs.join("\n"), duration: Date.now() - t0,
  };
};

// ── Full flow: mount → install → build → start dev server ──
type BackendSandboxCommand = {
  name: "install" | "build" | "lint" | "test";
  success: boolean;
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  duration: number;
};

type BackendSandboxResult = {
  success: boolean;
  status: "queued" | "running" | "passed" | "failed" | "timeout" | "error";
  commands: BackendSandboxCommand[];
  errors: string[];
  warnings: string[];
  allOutput: string;
  duration: number;
};

type BackendSandboxJob = {
  id: string;
  result: BackendSandboxResult | null;
};

const backendCommandToResult = (command: BackendSandboxCommand): CommandResult => ({
  success: command.success,
  stdout: command.stdout,
  stderr: command.stderr,
  exitCode: command.exitCode ?? 1,
  duration: command.duration,
});

const backendResultToBuildResult = (result: BackendSandboxResult): BuildResult => {
  const command = (name: BackendSandboxCommand["name"]) => result.commands.find((item) => item.name === name);
  return {
    success: result.success,
    installResult: command("install") ? backendCommandToResult(command("install")!) : null,
    buildResult: command("build") ? backendCommandToResult(command("build")!) : null,
    lintResult: command("lint") ? backendCommandToResult(command("lint")!) : null,
    testResult: command("test") ? backendCommandToResult(command("test")!) : null,
    errors: result.errors,
    warnings: result.warnings,
    allOutput: result.allOutput,
    duration: result.duration,
  };
};

const streamBackendJob = async (jobId: string): Promise<BackendSandboxResult> => {
  const response = await fetch(`/api/sandbox/jobs/${jobId}/stream`, {
    headers: { Authorization: aiJsonHeaders().Authorization },
  });
  if (!response.ok) throw new Error(await readApiError(response, "Sandbox Runner"));

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Sandbox Runner returned no stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: BackendSandboxResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const parsed = JSON.parse(dataLine.slice(5).trim()) as { type: string; line?: string; result?: BackendSandboxResult };
      if (parsed.type === "log" && parsed.line) emitBuildLog(parsed.line);
      if (parsed.type === "done" && parsed.result) finalResult = parsed.result;
    }
  }

  if (finalResult) return finalResult;

  const resultResponse = await fetch(`/api/sandbox/jobs/${jobId}`, {
    headers: { Authorization: aiJsonHeaders().Authorization },
  });
  if (!resultResponse.ok) throw new Error(await readApiError(resultResponse, "Sandbox Runner"));
  const job = (await resultResponse.json()) as BackendSandboxJob;
  if (!job.result) throw new Error("Sandbox Runner finished without a persisted result");
  return job.result;
};

const runBackendBuildPipeline = async (files: GeneratedFile[]): Promise<BuildResult> => {
  emitBuildLog("[cloud-sandbox] Creating isolated backend job...");
  const response = await fetch("/api/sandbox/jobs", {
    method: "POST",
    headers: aiJsonHeaders(),
    body: JSON.stringify({
      files: files.map((file) => ({ path: file.path, content: file.content ?? "" })),
      commands: ["install", "build", "lint", "test"],
      timeoutMs: 120000,
    }),
  });
  if (!response.ok) throw new Error(await readApiError(response, "Sandbox Runner"));

  const job = (await response.json()) as BackendSandboxJob;
  emitBuildLog(`[cloud-sandbox] Job ${job.id} started`);
  const result = await streamBackendJob(job.id);
  emitBuildLog(`[cloud-sandbox] Job ${job.id} ${result.success ? "passed" : "failed"} in ${(result.duration / 1000).toFixed(1)}s`);
  return backendResultToBuildResult(result);
};

export const runBuildPipeline = async (files: GeneratedFile[]): Promise<BuildResult> => {
  try {
    return await runBackendBuildPipeline(files);
  } catch (error) {
    emitBuildLog(`[cloud-sandbox] Backend runner unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    emitBuildLog("[cloud-sandbox] Falling back to WebContainer sandbox...");
    return runWebContainerBuildPipeline(files);
  }
};

export const runAndPreview = async (files: GeneratedFile[]): Promise<BuildResult> => {
  const buildResult = await runBuildPipeline(files);
  if (buildResult.success) {
    emitBuildLog("[sandbox] Build passed — starting dev server...");
    await startDevServer();
  } else {
    emitBuildLog("[sandbox] Build failed — preview unavailable");
  }
  return buildResult;
};
