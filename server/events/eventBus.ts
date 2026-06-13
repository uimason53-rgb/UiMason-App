type EventHandler = (data: unknown) => void;

export class EventBus {
  private listeners: Map<string, EventHandler[]> = new Map();
  private history: Array<{ event: string; data: unknown; timestamp: number }> = [];

  on(event: string, handler: EventHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler) {
    const handlers = this.listeners.get(event) || [];
    this.listeners.set(event, handlers.filter(h => h !== handler));
  }

  emit(event: string, data: unknown) {
    this.history.push({ event, data, timestamp: Date.now() });
    console.log(`[EventBus] ${event}`, JSON.stringify(data).slice(0, 100));
    const handlers = this.listeners.get(event) || [];
    handlers.forEach(h => h(data));
  }

  getHistory() {
    return this.history;
  }

  clear() {
    this.listeners.clear();
    this.history = [];
  }
}

export const eventBus = new EventBus();