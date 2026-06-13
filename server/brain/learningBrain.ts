import { BrainProvider } from "../llm/brainProvider";

const brain = new BrainProvider();

export class LearningBrain {
  async improve(result: string): Promise<string> {
    console.log(`[LearningBrain] Learning from result...`);

    const response = await brain.generate({
      systemPrompt: "You are a learning engine. Analyze results, identify what went well and what failed, and suggest improvements for next time.",
      prompt: `Analyze this result and suggest improvements:\n\n${result}`,
      temperature: 0.4,
    });

    return response.content;
  }
}