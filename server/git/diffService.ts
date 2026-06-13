import { commandRunner } from "../sandbox/commandRunner";
import type { GitDiff } from "./types/git.types";

export class DiffService {
  async generate(file?: string): Promise<GitDiff> {
    console.log(`[DiffService] Generating diff: ${file || "all"}`);
    const cmd = file ? `git diff ${file}` : "git diff";
    const result = await commandRunner(cmd);

    return {
      file: file || "all",
      changes: result.stdout,
    };
  }

  async staged(): Promise<GitDiff> {
    const result = await commandRunner("git diff --staged");
    return { file: "staged", changes: result.stdout };
  }

  async summary(): Promise<string> {
    const result = await commandRunner("git diff --stat");
    return result.stdout;
  }
}