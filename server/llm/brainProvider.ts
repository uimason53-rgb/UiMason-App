import type { LLMProvider, LLMRequest, LLMResponse } from "./types/llm.types";

const OPENAI_KEY = process.env.OPENAI_KEY || "";

export class BrainProvider implements LLMProvider {
  async generate(request: LLMRequest): Promise<LLMResponse> {
    console.log(`[BrainProvider] Thinking: "${request.prompt.slice(0, 60)}..."`);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: request.systemPrompt || "You are a senior AI software engineering assistant." },
          { role: "user", content: request.prompt },
        ],
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 2048,
      }),
    });

    const data = await response.json() as any;

    if (data.error) {
      throw new Error(`BrainProvider error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content || "";
    const usage = data.usage;

    console.log(`[BrainProvider] Done. Tokens: ${usage?.total_tokens ?? "?"}`);

    return { content, usage };
  }
}