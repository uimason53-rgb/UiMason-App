import { PlannerAgent } from "../services/agents/plannerAgent";
import { ArchitectAgent } from "../services/agents/architectAgent";
import { CodeAgent } from "../services/agents/codeAgent";
import { ReviewAgent } from "../services/agents/reviewAgent";
import { DebugAgent } from "../services/agents/debugAgent";
import type { AgentResult } from "../services/agents/types/agent.types";
import * as fs from "fs";
import * as path from "path";

export class AgentCoordinator {
  private planner = new PlannerAgent();
  private architect = new ArchitectAgent();
  private coder = new CodeAgent();
  private reviewer = new ReviewAgent();
  private debugger = new DebugAgent();

  async run(request: string, projectPath: string): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Coordinator] Starting: "${request}"`);
    console.log(`${"=".repeat(60)}\n`);

    // Step 1 — Architect analyze project
    const archStart = Date.now();
    console.log("[Coordinator] Step 1: Architect analyzing project...");
    const analysis = await this.architect.analyze(projectPath);
    results.push({
      agent: "architect",
      success: true,
      output: analysis,
      timestamp: Date.now(),
      duration: Date.now() - archStart,
    });

    // Step 2 — Planner break down task
    const planStart = Date.now();
    console.log("\n[Coordinator] Step 2: Planner breaking down task...");
    const tasks = await this.planner.plan(request);
    results.push({
      agent: "planner",
      success: tasks.length > 0,
      output: tasks,
      timestamp: Date.now(),
      duration: Date.now() - planStart,
    });

    if (tasks.length === 0) {
      console.log("[Coordinator] No tasks generated. Stopping.");
      return results;
    }

    // Step 3 — CodeAgent implement each task
    console.log(`\n[Coordinator] Step 3: CodeAgent implementing ${tasks.length} tasks...`);
    for (const task of tasks) {
      const codeStart = Date.now();
      console.log(`\n[Coordinator] Coding: "${task.title}"`);

      const targetFile = `generated/${task.id}_${task.title.replace(/\s+/g, "_").toLowerCase()}.ts`;
      const codeResult = await this.coder.code(
        `${task.description}\n\nProject context:\n${analysis.structure}`,
        targetFile
      );

      // Step 4 — ReviewAgent review each file
      console.log(`[Coordinator] Reviewing: "${targetFile}"`);
      const code = fs.readFileSync(path.join(process.cwd(), targetFile), "utf-8");
      const review = await this.reviewer.review(code, targetFile);

      // Step 5 — DebugAgent fix if review failed
      if (!review.approved && review.issues.length > 0) {
        console.log(`[Coordinator] Issues found — DebugAgent fixing...`);
        const debugResult = await this.debugger.debug(code, review.issues.join(", "));
        if (debugResult.fixedCode) {
          fs.writeFileSync(path.join(process.cwd(), targetFile), debugResult.fixedCode, "utf-8");
          console.log(`[Coordinator] Fixed and saved: ${targetFile}`);
        }
      }

      results.push({
        agent: "code+review",
        success: codeResult.success,
        output: codeResult,
        timestamp: Date.now(),
        duration: Date.now() - codeStart,
      });
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Coordinator] Done! ${results.length} steps completed.`);
    console.log(`${"=".repeat(60)}\n`);

    return results;
  }
}

// Test
const coordinator = new AgentCoordinator();
coordinator.run("Tambah Google OAuth login", "./server")
  .then((results) => {
    console.log(`\nTotal steps: ${results.length}`);
    results.forEach(r => console.log(`  [${r.agent}] ${r.success ? "✓" : "✗"} (${r.duration}ms)`));
  })
  .catch(console.error);