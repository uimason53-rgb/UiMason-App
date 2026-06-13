const OPENAI_KEY = process.env.OPENAI_KEY || "";

export interface DebugResult {
  rootCause: string;
  fix: string;
  fixedCode: string;
  confidence: number;
}

export class DebugAgent {
  async debug(code: string, error: string): Promise<DebugResult> {
    console.log(`\n[DebugAgent] Debugging error: "${error}"\n`);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: "You are an expert debugger. Find root cause and fix bugs. Reply ONLY with JSON, no markdown.",
        }, {
          role: "user",
          content: `Debug this error and reply ONLY this JSON:
{"rootCause":"...","fix":"...","fixedCode":"...","confidence":0-100}

Error: ${error}

Code:
${code}`,
        }],
        temperature: 0.3,
      }),
    });

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content || "";

    let result: DebugResult = { rootCause: "", fix: "", fixedCode: "", confidence: 0 };
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    } catch (e) {
      result.rootCause = "Failed to parse debug result";
    }

    console.log(`[DebugAgent] Root cause: ${result.rootCause}`);
    console.log(`[DebugAgent] Fix: ${result.fix}`);
    console.log(`[DebugAgent] Confidence: ${result.confidence}%`);

    return result;
  }
}