import { BrainProvider } from "../llm/brainProvider";

const brain = new BrainProvider();

export class ReasoningBrain {
  async think(input: string): Promise<string> {
    console.log(`[ReasoningBrain] Thinking...`);

    const response = await brain.generate({
      systemPrompt: "You are a reasoning engine. Think step by step, identify the core problem, and provide a clear, structured analysis.",
      prompt: input,
      temperature: 0.3,
    });

    return response.content;
  }
}