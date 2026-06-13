import type { Task } from "./types/task.types";

export class TaskQueue {
  private queue: Task[] = [];

  enqueue(task: Task) {
    this.queue.push(task);
    console.log(`[TaskQueue] Enqueued: "${task.title}" | Queue size: ${this.queue.length}`);
  }

  dequeue(): Task | undefined {
    const task = this.queue.shift();
    if (task) console.log(`[TaskQueue] Dequeued: "${task.title}" | Queue size: ${this.queue.length}`);
    return task;
  }

  getAll(): Task[] {
    return this.queue;
  }

  peek(): Task | undefined {
    return this.queue[0];
  }

  size(): number {
    return this.queue.length;
  }

  clear() {
    this.queue = [];
    console.log(`[TaskQueue] Cleared`);
  }
}