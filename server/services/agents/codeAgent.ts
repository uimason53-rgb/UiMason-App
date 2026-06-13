import * as fs from "fs";
import * as path from "path";

const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || "";

export interface CodeResult {
  file: string;
  content: string;
  success: boolean;
}

export class CodeAgent {
  async code(task: string, targetFile: string): Promise<CodeResult> {
    console.log(`\n[CodeAgent] Working on: "${task}"\n`);

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{
          role: "system",
          content: "You are an expert software engineer. Write clean, production-ready code. Reply ONLY with the code, no explanation, no markdown backticks.",
        }, {
          role: "user",
          content: task,
        }],
        temperature: 0.3,
      }),
    });

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || "";

    console.log(`[CodeAgent] Generated ${content.length} chars`);

    // Save to file
    const fullPath = path.join(process.cwd(), targetFile);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");

    console.log(`[CodeAgent] Saved to: ${targetFile}`);

    return { file: targetFile, content, success: true };
  }
}

// Test
const agent = new CodeAgent();
agent.code(
  "Write a TypeScript Express middleware function that validates JWT tokens",
  "generated/jwtMiddleware.ts"
).then((result) => {
  console.log("\nDone! File saved:", result.file);
}).catch(console.error);