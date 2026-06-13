import { SessionStore } from "./executionSession";
import { ExecutionState } from "./executionState";
import { ExecutionHistory } from "./executionHistory";
import { eventBus } from "../events/eventBus";
import type { ExecutionContext } from "./types/execution.types";

export class ExecutionManager {
  private sessions = new SessionStore();
  private states = new ExecutionState();
  private history = new ExecutionHistory();

  start(sessionId: string, context: ExecutionContext) {
    console.log(`[ExecutionManager] Starting: ${sessionId}`);

    this.sessions.create({
      id: sessionId,
      status: "running",
      context,
    });

    this.states.set(sessionId, "running");
    this.history.add({ timestamp: Date.now(), action: "started" });
    eventBus.emit("execution:started", { sessionId, context });
  }

  pause(sessionId: string) {
    console.log(`[ExecutionManager] Pausing: ${sessionId}`);
    this.states.set(sessionId, "paused");
    this.history.add({ timestamp: Date.now(), action: "paused" });
    eventBus.emit("execution:paused", { sessionId });
  }

  resume(sessionId: string) {
    console.log(`[ExecutionManager] Resuming: ${sessionId}`);
    this.states.set(sessionId, "running");
    this.history.add({ timestamp: Date.now(), action: "resumed" });
    eventBus.emit("execution:resumed", { sessionId });
  }

  complete(sessionId: string) {
    console.log(`[ExecutionManager] Completed: ${sessionId}`);
    this.states.set(sessionId, "completed");
    this.history.add({ timestamp: Date.now(), action: "completed" });
    eventBus.emit("execution:completed", { sessionId });
  }

  fail(sessionId: string, error: string) {
    console.log(`[ExecutionManager] Failed: ${sessionId} — ${error}`);
    this.states.set(sessionId, "failed");
    this.history.add({ timestamp: Date.now(), action: `failed: ${error}` });
    eventBus.emit("execution:failed", { sessionId, error });
  }

  getState(sessionId: string) {
    return this.states.get(sessionId);
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  getHistory() {
    return this.history.getAll();
  }
}