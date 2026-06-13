import type { Task } from "./types/task.types";

export class TaskHistory {
  private history: Task[] = [];

  add(task: Task) {
    this.history.push({ ...task, completedAt: Date.now() });
    console.log(`[TaskHistory] Recorded: "${task.title}" [${task.status}]`);
  }

  getAll(): Task[] {
    return this.history;
  }

  getByStatus(status: Task["status"]): Task[] {
    return this.history.filter(t => t.status === status);
  }

  getLast(n = 10): Task[] {
    return this.history.slice(-n);
  }

  clear() {
    this.history = [];
  }
}