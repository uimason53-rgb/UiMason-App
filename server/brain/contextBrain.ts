import { BrainProvider } from "../llm/brainProvider";

const brain = new BrainProvider();

export class ContextBrain {
  async build(context: string): Promise<string> {
    console.log(`[ContextBrain] Building context...`);

    const response = await brain.generate({
      systemPrompt: "You are a context analyzer. Summarize and structure the given context to be useful for an AI agent making decisions.",
      prompt: `Analyze and structure this context:\n\n${context}`,
      temperature: 0.2,
    });

    return response.content;
  }
}