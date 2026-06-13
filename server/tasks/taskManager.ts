import type { Task, TaskResult } from "./types/task.types";
import { TaskQueue } from "./taskQueue";
import { TaskExecutor } from "./taskExecutor";
import { TaskHistory } from "./taskHistory";
import { TaskRetry } from "./taskRetry";
import { eventBus } from "../events/eventBus";

export class TaskManager {
  private queue = new TaskQueue();
  private executor = new TaskExecutor();
  private history = new TaskHistory();
  private retry = new TaskRetry();

  async submit(task: Task): Promise<TaskResult> {
    const start = Date.now();
    console.log(`\n[TaskManager] Submitted: "${task.title}" [${task.priority}]`);
    eventBus.emit("taskmanager:submitted", { id: task.id, title: task.title });

    // Enqueue dulu
    this.queue.enqueue(task);

    let result: TaskResult = {
      taskId: task.id,
      success: false,
      duration: 0,
    };

    // Execute
    const execResult = await this.executor.execute(task);

    result = {
      taskId: task.id,
      success: execResult.success,
      output: execResult.output,
      error: execResult.error,
      duration: Date.now() - start,
    };

    // Retry kalau fail
    if (!result.success && task.retryCount < 3) {
      console.log(`[TaskManager] Retrying... (${task.retryCount + 1}/3)`);
      task.retryCount += 1;
      this.retry.schedule(task);
      return this.submit(task);
    }

    // Save to history
    this.history.add(task);
    this.queue.dequeue();

    console.log(`[TaskManager] ${result.success ? "✓" : "✗"} "${task.title}" (${result.duration}ms)`);
    eventBus.emit("taskmanager:done", result);

    return result;
  }

  getQueue() {
    return this.queue.getAll();
  }

  getHistory() {
    return this.history.getAll();
  }

  getPending() {
    return this.queue.getAll().filter(t => t.status === "pending");
  }
}