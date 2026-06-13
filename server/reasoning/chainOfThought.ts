import { BrainProvider } from "../llm/brainProvider";
import type { ReasoningStep } from "./types/reasoning.types";

const brain = new BrainProvider();

export class ChainOfThought {
  async think(input: string): Promise<ReasoningStep[]> {
    console.log(`[ChainOfThought] Processing...`);

    const response = await brain.generate({
      systemPrompt: "You are a chain-of-thought reasoner. Break down problems into clear numbered steps. Each step builds on the previous one.",
      prompt: `Think through this step by step:\n\n${input}`,
      temperature: 0.3,
    });

    const lines = response.content
      .split("\n")
      .filter(l => l.trim())
      .map((line, i) => ({
        thought: line.replace(/^\d+\.\s*/, "").trim(),
        confidence: Math.max(0.6, 1 - i * 0.05),
      }));

    console.log(`[ChainOfThought] ${lines.length} steps generated`);
    return lines;
  }
}