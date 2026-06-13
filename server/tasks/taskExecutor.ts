import type { Task } from "./types/task.types";
import { CodingProvider } from "../llm/codingProvider";
import { BrainProvider } from "../llm/brainProvider";
import { eventBus } from "../events/eventBus";
import * as fs from "fs";
import * as path from "path";

const coder = new CodingProvider();
const brain = new BrainProvider();

export class TaskExecutor {
  async execute(task: Task): Promise<{ success: boolean; output?: string; error?: string }> {
    const start = Date.now();
    task.status = "running";
    console.log(`\n[TaskExecutor] Executing: "${task.title}"`);
    eventBus.emit("task:started", { id: task.id, title: task.title });

    try {
      let output = "";

      switch (task.type) {
        case "code":
          output = await this.executeCode(task);
          break;
        case "plan":
          output = await this.executePlan(task);
          break;
        case "review":
          output = await this.executeReview(task);
          break;
        default:
          output = await this.executeGeneral(task);
      }

      task.status = "completed";
      const duration = Date.now() - start;
      console.log(`[TaskExecutor] Done in ${duration}ms`);
      eventBus.emit("task:completed", { id: task.id, duration });

      return { success: true, output };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      task.status = "failed";
      console.error(`[TaskExecutor] Failed: ${msg}`);
      eventBus.emit("task:failed", { id: task.id, error: msg });

      return { success: false, error: msg };
    }
  }

  private async executeCode(task: Task): Promise<string> {
    const response = await coder.generate({
      systemPrompt: "You are an expert software engineer. Write clean, production-ready TypeScript code only. No explanation, no markdown.",
      prompt: `${task.description}\n\nContext: ${task.context || "none"}`,
      temperature: 0.2,
      maxTokens: 4096,
    });

    // Save to file if outputPath specified
    if (task.outputPath) {
      const fullPath = path.join(process.cwd(), task.outputPath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, response.content, "utf-8");
      console.log(`[TaskExecutor] Saved to: ${task.outputPath}`);
    }

    return response.content;
  }

  private async executePlan(task: Task): Promise<string> {
    const response = await brain.generate({
      systemPrompt: "You are a senior software architect. Create detailed, actionable plans.",
      prompt: `Create a detailed plan for: ${task.description}`,
      temperature: 0.3,
    });

    return response.content;
  }

  private async executeReview(task: Task): Promise<string> {
    const response = await brain.generate({
      systemPrompt: "You are a senior code reviewer. Review for bugs, security, and best practices.",
      prompt: `Review this:\n\n${task.description}`,
      temperature: 0.3,
    });

    return response.content;
  }

  private async executeGeneral(task: Task): Promise<string> {
    const response = await brain.generate({
      systemPrompt: "You are a helpful AI assistant. Complete the given task.",
      prompt: task.description,
      temperature: 0.3,
    });

    return response.content;
  }
}