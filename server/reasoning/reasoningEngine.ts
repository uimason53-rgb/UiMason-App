import { BrainProvider } from "../llm/brainProvider";
import { eventBus } from "../events/eventBus";

export interface ReasoningResult {
  thoughts: string[];
  conclusion: string;
  confidence: number;
  strategy: "cot" | "tot" | "reflection";
}

export class ReasoningEngine {
  private brain = new BrainProvider();

  async reason(input: string, strategy: "cot" | "tot" | "reflection" = "cot"): Promise<ReasoningResult> {
    console.log(`\n[ReasoningEngine] Strategy: ${strategy}`);
    eventBus.emit("reasoning:started", { input: input.slice(0, 60), strategy });

    let result: ReasoningResult;

    switch (strategy) {
      case "cot":
        result = await this.chainOfThought(input);
        break;
      case "tot":
        result = await this.treeOfThought(input);
        break;
      case "reflection":
        result = await this.selfReflection(input);
        break;
    }

    eventBus.emit("reasoning:completed", { strategy, confidence: result.confidence });
    return result;
  }

  private async chainOfThought(input: string): Promise<ReasoningResult> {
    const response = await this.brain.generate({
      systemPrompt: "You are a chain-of-thought reasoner. Think step by step. Break down the problem into clear numbered steps, then give a final conclusion.",
      prompt: `Problem: ${input}\n\nThink through this step by step:`,
      temperature: 0.3,
    });

    const lines = response.content.split("\n").filter(l => l.trim());
    const thoughts = lines.slice(0, -1);
    const conclusion = lines[lines.length - 1] || response.content;

    console.log(`[ReasoningEngine] CoT — ${thoughts.length} thoughts`);
    return { thoughts, conclusion, confidence: 0.85, strategy: "cot" };
  }

  private async treeOfThought(input: string): Promise<ReasoningResult> {
    const response = await this.brain.generate({
      systemPrompt: "You are a tree-of-thought reasoner. Generate 3 different approaches to solve the problem. Evaluate each, then pick the best one as your conclusion.",
      prompt: `Problem: ${input}\n\nGenerate 3 approaches, evaluate them, pick the best:`,
      temperature: 0.5,
    });

    const lines = response.content.split("\n").filter(l => l.trim());
    const thoughts = lines.slice(0, -1);
    const conclusion = lines[lines.length - 1] || response.content;

    console.log(`[ReasoningEngine] ToT — ${thoughts.length} branches`);
    return { thoughts, conclusion, confidence: 0.9, strategy: "tot" };
  }

  private async selfReflection(input: string): Promise<ReasoningResult> {
    // Step 1 — initial answer
    const initial = await this.brain.generate({
      systemPrompt: "You are an AI agent. Answer the problem directly.",
      prompt: input,
      temperature: 0.3,
    });

    // Step 2 — reflect on answer
    const reflection = await this.brain.generate({
      systemPrompt: "You are a critical reviewer. Find flaws, gaps, or improvements in the given answer.",
      prompt: `Original answer:\n${initial.content}\n\nCritique and improve:`,
      temperature: 0.4,
    });

    console.log(`[ReasoningEngine] Reflection — 2 passes done`);
    return {
      thoughts: [initial.content, reflection.content],
      conclusion: reflection.content,
      confidence: 0.92,
      strategy: "reflection",
    };
  }

  async bestStrategy(input: string): Promise<ReasoningResult> {
    const len = input.length;
    if (len < 200) return this.reason(input, "cot");
    if (len < 500) return this.reason(input, "tot");
    return this.reason(input, "reflection");
  }
}