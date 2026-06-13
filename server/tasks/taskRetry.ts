import type { Task } from "./types/task.types";

export class TaskRetry {
  private maxRetries = 3;
  private scheduled: Task[] = [];

  canRetry(retryCount: number): boolean {
    return retryCount < this.maxRetries;
  }

  schedule(task: Task) {
    this.scheduled.push(task);
    console.log(`[TaskRetry] Scheduled retry for: "${task.title}" (attempt ${task.retryCount})`);
  }

  getScheduled(): Task[] {
    return this.scheduled;
  }

  clear() {
    this.scheduled = [];
  }
}