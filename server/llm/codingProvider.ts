import type { LLMProvider, LLMRequest, LLMResponse } from "./types/llm.types";

const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || "";

export class CodingProvider implements LLMProvider {
  async generate(request: LLMRequest): Promise<LLMResponse> {
    console.log(`[CodingProvider] Coding: "${request.prompt.slice(0, 60)}..."`);

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: request.systemPrompt || "You are an expert software engineer. Write clean, production-ready code only." },
          { role: "user", content: request.prompt },
        ],
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 4096,
      }),
    });

    const data = await response.json() as any;

    if (data.error) {
      throw new Error(`CodingProvider error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content || "";
    const usage = data.usage;

    console.log(`[CodingProvider] Done. Tokens: ${usage?.total_tokens ?? "?"}`);

    return { content, usage };
  }
}