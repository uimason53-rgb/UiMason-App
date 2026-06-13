import { BrainProvider } from "../llm/brainProvider";
import { eventBus } from "../events/eventBus";

export interface FeedbackResult {
  sentiment: "positive" | "negative" | "neutral";
  score: number;
  issues: string[];
  improvements: string[];
}

const brain = new BrainProvider();

export class FeedbackAnalyzer {
  async analyze(feedback: string): Promise<FeedbackResult> {
    console.log(`[FeedbackAnalyzer] Analyzing feedback...`);

    const response = await brain.generate({
      systemPrompt: "You are a feedback analysis engine. Analyze feedback and extract actionable insights. Reply ONLY with JSON.",
      prompt: `Analyze this feedback and reply ONLY this JSON:
{
  "sentiment": "positive|negative|neutral",
  "score": 0-100,
  "issues": ["issue1", "issue2"],
  "improvements": ["improvement1", "improvement2"]
}

Feedback: ${feedback}`,
      temperature: 0.2,
    });

    let result: FeedbackResult = {
      sentiment: "neutral",
      score: 50,
      issues: [],
      improvements: [],
    };

    try {
      const match = response.content.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    } catch {
      console.warn(`[FeedbackAnalyzer] Could not parse JSON`);
    }

    console.log(`[FeedbackAnalyzer] Sentiment: ${result.sentiment} | Score: ${result.score}`);
    eventBus.emit("feedback:analyzed", result);

    return result;
  }
}