const OPENAI_KEY = process.env.OPENAI_KEY || "";

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  order: number;
}

export class PlannerAgent {
  async plan(request: string): Promise<AgentTask[]> {
    console.log(`\n[PlannerAgent] Planning: "${request}"\n`);

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
          content: "You are a senior software architect. Reply ONLY with a JSON array, no markdown, no explanation.",
        }, {
          role: "user",
          content: `Break down into tasks: ${request}
          
Format: [{"id":"1","title":"...","description":"...","order":1}]`,
        }],
        temperature: 0.3,
      }),
    });

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content || "";
    
    console.log("GPT raw reply:", text); // debug
    console.log("API response:", JSON.stringify(data).slice(0, 200)); // debug

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No valid JSON");

    const tasks: AgentTask[] = JSON.parse(jsonMatch[0]);
    tasks.forEach((t) => console.log(`  [${t.order}] ${t.title}`));
    return tasks;
  }
}

const agent = new PlannerAgent();
agent.plan("Tambah Google OAuth login")
  .then((tasks) => console.log("\nDone:", JSON.stringify(tasks, null, 2)))
  .catch(console.error);