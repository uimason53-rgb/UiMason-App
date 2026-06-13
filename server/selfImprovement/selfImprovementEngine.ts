import { BrainProvider } from "../llm/brainProvider";
import { eventBus } from "../events/eventBus";

export interface ImprovementResult {
  feedback: string;
  lessons: string[];
  nextStrategy: string;
  score: number;
}

export class SelfImprovementEngine {
  private brain = new BrainProvider();
  private history: ImprovementResult[] = [];

  async improve(
    task: string,
    result: string,
    success: boolean
  ): Promise<ImprovementResult> {
    console.log(`\n[SelfImprovementEngine] Analyzing ${success ? "success" : "failure"}...`);
    eventBus.emit("improvement:started", { task: task.slice(0, 60), success });

    const response = await this.brain.generate({
      systemPrompt: "You are a self-improvement engine for an AI agent. Analyze task results, extract lessons, and suggest better strategies. Reply ONLY with JSON.",
      prompt: `Task: ${task}
Result: ${result}
Success: ${success}

Reply ONLY this JSON:
{
  "feedback": "what happened",
  "lessons": ["lesson1", "lesson2"],
  "nextStrategy": "what to do differently next time",
  "score": 0-100
}`,
      temperature: 0.3,
    });

    let parsed: ImprovementResult = {
      feedback: result,
      lessons: [],
      nextStrategy: "retry",
      score: success ? 80 : 30,
    };

    try {
      const match = response.content.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      console.warn("[SelfImprovementEngine] Could not parse JSON, using defaults");
    }

    this.history.push(parsed);
    console.log(`[SelfImprovementEngine] Score: ${parsed.score}/100`);
    console.log(`[SelfImprovementEngine] Lessons: ${parsed.lessons.length}`);
    eventBus.emit("improvement:completed", parsed);

    return parsed;
  }

  getHistory() {
    return this.history;
  }

  averageScore() {
    if (!this.history.length) return 0;
    return Math.round(
      this.history.reduce((sum, h) => sum + h.score, 0) / this.history.length
    );
  }
}