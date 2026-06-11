import type { GeneratedFile } from "./claudeService";
import { fixCode } from "./claudeService";
import { runBuildPipeline } from "./sandboxService";
import type { BuildResult } from "./sandboxService";

export type RepairLoopLogType = "info" | "running" | "warning" | "error" | "success";

export type FixFunction = (
  originalFiles: GeneratedFile[],
  errorMessage: string,
  onChunk?: (text: string) => void
) => Promise<{ files: GeneratedFile[] }>;

export type RepairLoopOptions = {
  maxAttempts?: number;
  onChunk?: (text: string) => void;
  log?: (type: RepairLoopLogType, message: string) => void;
  fixFn?: FixFunction;
};

export type RepairLoopResult = {
  files: GeneratedFile[];
  success: boolean;
  attempts: number;
  lastBuildResult: BuildResult | null;
  errorHistory: string[];
};

const buildErrorPrompt = (errors: string[]): string => {
  return `The project build failed with the following errors:\n${errors.join("\n")}\n\nPlease fix the project and return ALL files in <file path="..."> tags. Preserve the original structure and avoid unrelated changes.`;
};

export const runRepairLoop = async (
  initialFiles: GeneratedFile[],
  options: RepairLoopOptions = {}
): Promise<RepairLoopResult> => {
  const maxAttempts = options.maxAttempts ?? 3;
  const log = options.log ?? (() => undefined);
  const onChunk = options.onChunk;
  const fixFn: FixFunction = options.fixFn ?? fixCode;

  let files = initialFiles;
  let lastBuildResult: BuildResult | null = null;
  const errorHistory: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log("running", `Repair loop attempt ${attempt}/${maxAttempts}: validating build...`);
    const buildResult = await runBuildPipeline(files);
    lastBuildResult = buildResult;
    if (buildResult.success) {
      log("success", `Build succeeded on attempt ${attempt}.`);
      return {
        files,
        success: true,
        attempts: attempt,
        lastBuildResult,
        errorHistory,
      };
    }

    const errors = buildResult.errors.slice(0, 10);
    errorHistory.push(...errors);
    log("error", `Build failed on attempt ${attempt} with ${errors.length} error(s).`);

    if (attempt >= maxAttempts) {
      log("warning", `Maximum repair attempts reached (${maxAttempts}).`);
      break;
    }

    const prompt = buildErrorPrompt(errors);
    log("running", `Feeding build errors back into Builder Agent for repair...`);

    const fixed = await fixFn(files, prompt, onChunk);
    if (!fixed.files.length) {
      log("warning", "Builder Agent returned no files during repair.");
      break;
    }

    files = fixed.files;
  }

  return {
    files,
    success: false,
    attempts: maxAttempts,
    lastBuildResult,
    errorHistory,
  };
};
