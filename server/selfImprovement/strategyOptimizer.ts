import { BrainProvider } from "../llm/brainProvider";
import { eventBus } from "../events/eventBus";

export interface OptimizedStrategy {
  original: string;
  optimized: string;
  changes: string[];
  expectedImprovement: number;
}

const brain = new BrainProvider();

export class StrategyOptimizer {
  private strategies: OptimizedStrategy[] = [];

  async optimize(strategy: string): Promise<OptimizedStrategy> {
    console.log(`[StrategyOptimizer] Optimizing strategy...`);

    const response = await brain.generate({
      systemPrompt: "You are a strategy optimization engine. Analyze the current strategy and produce an improved version. Reply ONLY with JSON.",
      prompt: `Optimize this strategy and reply ONLY this JSON:
{
  "optimized": "improved strategy description",
  "changes": ["change1", "change2"],
  "expectedImprovement": 0-100
}

Strategy: ${strategy}`,
      temperature: 0.3,
    });

    let parsed = {
      optimized: strategy,
      changes: [],
      expectedImprovement: 0,
    } as any;

    try {
      const match = response.content.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      console.warn(`[StrategyOptimizer] Could not parse JSON`);
    }

    const result: OptimizedStrategy = {
      original: strategy,
      optimized: parsed.optimized,
      changes: parsed.changes,
      expectedImprovement: parsed.expectedImprovement,
    };

    this.strategies.push(result);
    console.log(`[StrategyOptimizer] Expected improvement: ${result.expectedImprovement}%`);
    eventBus.emit("strategy:optimized", result);

    return result;
  }

  getHistory(): OptimizedStrategy[] {
    return this.strategies;
  }
}