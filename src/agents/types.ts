// ─────────────────────────────────────────────────────────────
// agents/types.ts
// Shared types for the multi-agent mesh
// ─────────────────────────────────────────────────────────────

import type { GeneratedFile } from "../services/claudeService";
import type { ProjectPlan } from "../services/openaiService";

// ── Agent identity ───────────────────────────────────────────
export type AgentRole =
  | "architect"
  | "planner"
  | "executor"
  | "reviewer"
  | "debugger"
  | "buildVerifier";

export type AgentState =
  | "idle"
  | "thinking"
  | "working"
  | "waiting"
  | "done"
  | "error";

export type AgentMessage = {
  id: string;
  from: AgentRole;
  to: AgentRole | "orchestrator" | "user";
  type: "request" | "response" | "plan" | "code" | "review" | "fix" | "status" | "error";
  payload: unknown;
  timestamp: number;
};

// ── Agent task ───────────────────────────────────────────────
export type AgentTask = {
  id: string;
  role: AgentRole;
  instruction: string;
  context?: AgentContext;
  input?: unknown;
  priority: number; // 1-10, higher = more urgent
  dependencies: string[]; // IDs of tasks that must complete first
  status: "pending" | "in_progress" | "complete" | "failed";
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
};

// ── Context passed between agents ────────────────────────────
export type AgentContext = {
  userPrompt: string;
  projectName?: string;
  plan?: ProjectPlan;
  files?: GeneratedFile[];
  previousReviews?: ReviewResult[];
  errorHistory?: string[];
  constraints?: string[];
};

// ── Architecture output ──────────────────────────────────────
export type ArchitectureDecision = {
  decision: string;
  rationale: string;
  alternatives: string[];
  tradeoffs: string;
};

export type ArchitecturePlan = {
  projectName: string;
  description: string;
  architecture: string; // e.g. "SPA with React + Vite"
  stack: string[];
  decisions: ArchitectureDecision[];
  componentTree: string;
  dataFlow: string;
  risks: string[];
};

// ── Review output ────────────────────────────────────────────
export type ReviewIssue = {
  filePath: string;
  severity: "critical" | "warning" | "suggestion";
  category: "syntax" | "logic" | "performance" | "security" | "style" | "architecture";
  description: string;
  suggestion: string;
};

export type ReviewResult = {
  files: GeneratedFile[];
  issues: ReviewIssue[];
  score: number; // 0-100
  summary: string;
  passed: boolean; // score >= 70
};

// ── Debug output ─────────────────────────────────────────────
export type DebugResult = {
  originalFiles: GeneratedFile[];
  fixedFiles: GeneratedFile[];
  rootCause: string;
  fixApplied: string;
  confidence: number; // 0-1
  filesChanged: string[];
};

// ── Change plan (targeted editing) ──────────────────────────
export type ChangePlanEntry = {
  path: string;
  action: "modify" | "create" | "delete";
  reason: string;
};

export type ChangePlan = {
  filesToModify: string[];
  filesToCreate: string[];
  filesToDelete: string[];
  changes: ChangePlanEntry[];
  rationale: string[];
};

// ── Orchestrator state ───────────────────────────────────────
export type MeshState = {
  tasks: AgentTask[];
  messages: AgentMessage[];
  context: AgentContext;
  phase: "analysis" | "architecture" | "planning" | "execution" | "review" | "debug" | "done" | "error";
  iteration: number;
  maxIterations: number;
};