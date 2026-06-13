import { ShellExecutor } from "./shellExecutor";
import { NpmExecutor } from "./npmExecutor";
import { PythonExecutor } from "./pythonExecutor";
import { GitExecutor } from "./gitExecutor";
import { eventBus } from "../events/eventBus";

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

export class SandboxManager {
  private shell = new ShellExecutor();
  private npm = new NpmExecutor();
  private python = new PythonExecutor();
  private git = new GitExecutor();

  async run(command: string, type: "shell" | "npm" | "python" | "git" = "shell"): Promise<SandboxResult> {
    const start = Date.now();
    console.log(`\n[SandboxManager] Running ${type}: "${command}"`);
    eventBus.emit("sandbox:started", { command, type });

    try {
      let result: { stdout?: string; stderr?: string; output?: string };

      switch (type) {
        case "npm":
          result = await this.npm.execute(command);
          break;
        case "python":
          result = await this.python.execute(command);
          break;
        case "git":
          result = await this.git.execute(command);
          break;
        default:
          result = await this.shell.execute(command);
      }

      const output = result.stdout || result.output || "";
      const duration = Date.now() - start;

      console.log(`[SandboxManager] Done in ${duration}ms`);
      eventBus.emit("sandbox:completed", { command, duration });

      return { success: true, output, duration };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - start;
      console.error(`[SandboxManager] Failed: ${msg}`);
      eventBus.emit("sandbox:failed", { command, error: msg });

      return { success: false, output: "", error: msg, duration };
    }
  }

  async runShell(cmd: string) { return this.run(cmd, "shell"); }
  async runNpm(cmd: string) { return this.run(cmd, "npm"); }
  async runPython(cmd: string) { return this.run(cmd, "python"); }
  async runGit(cmd: string) { return this.run(cmd, "git"); }
}