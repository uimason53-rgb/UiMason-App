import { TaskBrain } from "./taskBrain";
import { ContextBrain } from "./contextBrain";
import { ReasoningBrain } from "./reasoningBrain";
import { LearningBrain } from "./learningBrain";
import type { BrainTask, BrainResult } from "./types/brain.types";
import { eventBus } from "../events/eventBus";

export class ExecutionBrain {
  private task = new TaskBrain();
  private context = new ContextBrain();
  private reasoning = new ReasoningBrain();
  private learning = new LearningBrain();

  async run(brainTask: BrainTask): Promise<BrainResult> {
    const start = Date.now();
    console.log(`\n[ExecutionBrain] Running task: "${brainTask.title}"`);
    eventBus.emit("brain:started", { taskId: brainTask.id });

    // Step 1 — build context
    const builtContext = await this.context.build(
      brainTask.context || brainTask.objective
    );

    // Step 2 — reason about task
    const reasoning = await this.reasoning.think(
      `Task: ${brainTask.title}\nContext: ${builtContext}`
    );

    // Step 3 — execute task
    const output = await this.task.execute({
      ...brainTask,
      context: reasoning,
    });

    // Step 4 — learn from result
    await this.learning.improve(output);

    const result: BrainResult = {
      taskId: brainTask.id,
      output,
      confidence: 0.85,
      duration: Date.now() - start,
    };

    console.log(`[ExecutionBrain] Done in ${result.duration}ms`);
    eventBus.emit("brain:completed", result);

    return result;
  }
}