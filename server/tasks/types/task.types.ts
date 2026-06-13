import type { TaskPriority } from "../taskPriority";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskType =
  | "code"
  | "plan"
  | "review"
  | "debug"
  | "general";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  retryCount: number;
  type?: TaskType;
  context?: string;
  outputPath?: string;
  createdAt?: number;
  completedAt?: number;
}

export interface TaskCheckpoint {
  taskId: string;
  timestamp: number;
  state: any;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}