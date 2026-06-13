import { BrainProvider } from "../llm/brainProvider";
import type { ReasoningStep } from "./types/reasoning.types";

const brain = new BrainProvider();

export class TreeOfThought {
  async expand(input: string): Promise<ReasoningStep[]> {
    console.log(`[TreeOfThought] Expanding branches...`);

    const response = await brain.generate({
      systemPrompt: "You are a tree-of-thought reasoner. Generate exactly 3 different approaches to solve the problem. Label them Approach A, B, C. End with BEST: and the letter of the best approach.",
      prompt: `Generate 3 approaches for:\n\n${input}`,
      temperature: 0.5,
    });

    const lines = response.content
      .split("\n")
      .filter(l => l.trim())
      .map((line, i) => {
        const isBest = line.toLowerCase().startsWith("best:");
        return {
          thought: line.trim(),
          confidence: isBest ? 0.95 : Math.max(0.5, 0.8 - i * 0.05),
        };
      });

    console.log(`[TreeOfThought] ${lines.length} branches expanded`);
    return lines;
  }
}