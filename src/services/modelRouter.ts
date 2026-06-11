export type ModelProvider = "deepseek" | "openai";
export type ModelTier = "low-cost" | "premium";

type ModelConfig = {
  provider: ModelProvider;
  model: string;
  tier: ModelTier;
  costPer1KInput: number;
  costPer1KOutput: number;
  maxTokens: number;
  capabilities: string[];
  role: string;
  responsibilities: string[];
};

const MODELS: Record<string, ModelConfig> = {
  "gpt-5.5": {
    provider: "openai",
    model: "gpt-5.5",
    tier: "premium",
    costPer1KInput: 0.02,
    costPer1KOutput: 0.02,
    maxTokens: 128000,
    capabilities: ["analysis", "architecture", "planning", "review"],
    role: "Brain",
    responsibilities: [
      "Requirement Analysis",
      "Product Planning",
      "Architecture Design",
      "System Design",
      "Database Planning",
      "Security Review",
      "Bug Investigation",
      "Code Audit",
      "Feature Impact Analysis",
      "Project Breakdown",
      "Task Planning",
      "Agent Orchestration",
      "PRD Generation",
      "Technical Documentation",
      "Roadmap Planning",
    ],
  },
  "deepseek-v4-pro": {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    tier: "low-cost",
    costPer1KInput: 0.00014,
    costPer1KOutput: 0.00028,
    maxTokens: 128000,
    capabilities: ["code", "implementation", "refactoring", "testing"],
    role: "Builder",
    responsibilities: [
      "React Components",
      "Next.js Pages",
      "Express APIs",
      "FastAPI APIs",
      "Database Models",
      "CRUD Operations",
      "Refactoring",
      "UI Development",
      "Backend Development",
      "Testing",
      "Code Generation",
      "Code Updates",
      "Feature Implementation",
    ],
  },
};

export type TaskComplexity = "simple" | "moderate" | "complex" | "critical";

export type RoutingDecision = {
  model: ModelConfig;
  reason: string;
  estimatedCost: string;
  fallbacks: ModelConfig[];
};

export const classifyComplexity = (prompt: string, hasFiles: boolean, fileCount: number): TaskComplexity => {
  const p = prompt.toLowerCase();
  if (p.length < 30 && !hasFiles) return "simple";
  if (fileCount > 10 || /\b(refactor|migrate|rearchitect|security audit|full test|performance optimize|scale)\b/.test(p)) return "complex";
  if (/deploy|production|critical|urgent|broken|crash|security|exploit|api key/.test(p)) return "critical";
  if (p.length < 150) return "moderate";
  return "complex";
};

const planKeywords = [
  "plan",
  "architecture",
  "audit",
  "review",
  "analyse",
  "investigate",
  "security",
  "database design",
  "system design",
];

const buildKeywords = [
  "create",
  "build",
  "generate",
  "code",
  "component",
  "api",
  "frontend",
  "backend",
  "crud",
];

const pick = (key: keyof typeof MODELS, reason: string): RoutingDecision => {
  const model = MODELS[key];
  const cost = `$${((model.costPer1KInput + model.costPer1KOutput) * 1000).toFixed(4)} / 1k tokens`;
  const fallback: ModelConfig[] = key === "gpt-5.5" ? [MODELS["deepseek-v4-pro"]] : [MODELS["gpt-5.5"]];
  return { model, reason, estimatedCost: cost, fallbacks: fallback };
};

export const routeModel = (prompt: string): RoutingDecision => {
  const normalized = prompt.toLowerCase();
  const wantsPlan = planKeywords.some((keyword) => normalized.includes(keyword));
  const wantsBuild = buildKeywords.some((keyword) => normalized.includes(keyword));

  if (wantsPlan && !wantsBuild) return pick("gpt-5.5", "Planning/analysis request — use GPT-5.5 Brain");
  if (wantsBuild && !wantsPlan) return pick("deepseek-v4-pro", "Implementation request — use DeepSeek V4 Pro Builder");
  if (wantsPlan && wantsBuild) return pick("gpt-5.5", "Mixed request — use GPT-5.5 for strategy and DeepSeek for execution");
  return pick("gpt-5.5", "Default to GPT-5.5 Brain for reasoning and architecture");
};

export const getProviderFromModel = (modelKey: string): ModelProvider => MODELS[modelKey]?.provider ?? "deepseek";

export const getModelList = (): ModelConfig[] => Object.values(MODELS);

export const estimateCost = (modelKey: string, inputTokens: number, outputTokens: number): number => {
  const m = MODELS[modelKey];
  if (!m) return 0;
  return (inputTokens * m.costPer1KInput + outputTokens * m.costPer1KOutput) / 1000;
};