export interface AgentTask {
  id: string;
  title: string;
  description: string;
  order: number;
}

export interface CodeResult {
  file: string;
  content: string;
  success: boolean;
}

export interface ArchitectureAnalysis {
  files: string[];
  structure: string;
  recommendations: string[];
}

export interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  score: number;
}

export interface DebugResult {
  rootCause: string;
  fix: string;
  fixedCode: string;
  confidence: number;
}

export interface AgentContext {
  projectPath: string;
  task: string;
  files?: string[];
}

export interface AgentResult {
  agent: string;
  success: boolean;
  output: AgentTask[] | CodeResult | ArchitectureAnalysis | ReviewResult | DebugResult;
  timestamp: number;
  duration: number;
}

export type AgentStatus = "idle" | "running" | "success" | "failed";

export type AgentName = "planner" | "architect" | "code" | "review" | "debug";