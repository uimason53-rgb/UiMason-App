import { BrainProvider } from "../llm/brainProvider";
import type { BrainTask } from "./types/brain.types";

const brain = new BrainProvider();

export class TaskBrain {
  async execute(task: BrainTask): Promise<string> {
    console.log(`[TaskBrain] Executing task: "${task.title}"`);

    const response = await brain.generate({
      systemPrompt: "You are a task execution planner. Given a task, produce a detailed, actionable execution plan.",
      prompt: `Task: ${task.title}\nDescription: ${task.description}\n\nProduce a step-by-step execution plan.`,
      temperature: 0.3,
    });

    return response.content;
  }
}