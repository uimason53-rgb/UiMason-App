import { BrainProvider } from "../llm/brainProvider";

const brain = new BrainProvider();

export class SelfReflection {
  async reflect(answer: string): Promise<string> {
    console.log(`[SelfReflection] Reflecting...`);

    const response = await brain.generate({
      systemPrompt: "You are a self-reflection engine. Critically evaluate the given answer. Find weaknesses, gaps, or errors. Then provide an improved version.",
      prompt: `Reflect on and improve this answer:\n\n${answer}\n\nProvide critique then improved answer:`,
      temperature: 0.4,
    });

    console.log(`[SelfReflection] Done`);
    return response.content;
  }
}