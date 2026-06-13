const OPENAI_KEY = process.env.OPENAI_KEY || "";

export interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  score: number;
}

export class ReviewAgent {
  async review(code: string, filename: string): Promise<ReviewResult> {
    console.log(`\n[ReviewAgent] Reviewing: "${filename}"\n`);

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
          content: "You are a senior code reviewer. Review code for bugs, security issues, and best practices. Reply ONLY with JSON, no markdown.",
        }, {
          role: "user",
          content: `Review this code and reply ONLY this JSON:
{"approved":true/false,"score":0-100,"issues":["issue1"],"suggestions":["suggestion1"]}

File: ${filename}
Code:
${code}`,
        }],
        temperature: 0.3,
      }),
    });

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content || "";
    console.log("[ReviewAgent] Result:", text);

    let result: ReviewResult = { approved: false, issues: [], suggestions: [], score: 0 };
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    } catch (e) {
      result.issues = ["Failed to parse review"];
    }

    console.log(`[ReviewAgent] Score: ${result.score}/100 | Approved: ${result.approved}`);
    result.issues.forEach(i => console.log(`  ⚠ ${i}`));
    result.suggestions.forEach(s => console.log(`  💡 ${s}`));

    return result;
  }
}