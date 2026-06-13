export interface BrainTask {
  id: string;
  title: string;
  description: string;
  objective: string;
  priority?: "low" | "medium" | "high";
  context?: string;
}

export interface BrainResult {
  taskId: string;
  output: string;
  confidence: number;
  duration: number;
}