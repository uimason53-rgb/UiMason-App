import { eventBus } from "../events/eventBus";
import { AgentCoordinator } from "../orchestrator/agentCoordinator";

export interface LoopConfig {
  maxIterations: number;
  retryLimit: number;
  delayMs: number;
}

export interface LoopResult {
  success: boolean;
  iterations: number;
  errors: string[];
  duration: number;
}

export class AutonomousLoop {
  private coordinator = new AgentCoordinator();
  private running = false;

  async run(request: string, projectPath: string, config: LoopConfig = {
    maxIterations: 5,
    retryLimit: 3,
    delayMs: 1000,
  }): Promise<LoopResult> {
    this.running = true;
    const startTime = Date.now();
    const errors: string[] = [];
    let iterations = 0;
    let retries = 0;

    console.log(`\n[AutonomousLoop] Starting...`);
    console.log(`[AutonomousLoop] Max iterations: ${config.maxIterations}`);
    console.log(`[AutonomousLoop] Retry limit: ${config.retryLimit}\n`);

    eventBus.emit("loop:started", { request, config });

    while (this.running && iterations < config.maxIterations) {
      iterations++;
      console.log(`\n[AutonomousLoop] Iteration ${iterations}/${config.maxIterations}`);
      eventBus.emit("loop:iteration", { iterations, request });

      try {
        const results = await this.coordinator.run(request, projectPath);
        const allSuccess = results.every(r => r.success);

        eventBus.emit("loop:iteration:done", { iterations, success: allSuccess });

        if (allSuccess) {
          console.log(`\n[AutonomousLoop] Task completed successfully at iteration ${iterations}`);
          eventBus.emit("loop:completed", { iterations, duration: Date.now() - startTime });
          this.running = false;
          break;
        }

        // Partial success — retry
        retries++;
        if (retries >= config.retryLimit) {
          console.log(`[AutonomousLoop] Retry limit reached. Stopping.`);
          eventBus.emit("loop:retry:limit", { retries });
          break;
        }

        console.log(`[AutonomousLoop] Partial success. Retry ${retries}/${config.retryLimit}...`);
        await this.delay(config.delayMs);

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Iteration ${iterations}: ${msg}`);
        console.error(`[AutonomousLoop] Error at iteration ${iterations}:`, msg);
        eventBus.emit("loop:error", { iterations, error: msg });

        retries++;
        if (retries >= config.retryLimit) {
          console.log(`[AutonomousLoop] Too many errors. Stopping.`);
          break;
        }

        await this.delay(config.delayMs);
      }
    }

    const result: LoopResult = {
      success: errors.length === 0,
      iterations,
      errors,
      duration: Date.now() - startTime,
    };

    console.log(`\n[AutonomousLoop] Done.`);
    console.log(`[AutonomousLoop] Iterations: ${iterations}`);
    console.log(`[AutonomousLoop] Duration: ${result.duration}ms`);
    console.log(`[AutonomousLoop] Errors: ${errors.length}`);

    eventBus.emit("loop:finished", result);
    return result;
  }

  stop() {
    console.log(`[AutonomousLoop] Stop requested.`);
    this.running = false;
    eventBus.emit("loop:stopped", { timestamp: Date.now() });
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}