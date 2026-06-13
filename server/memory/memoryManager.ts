import { MemoryStore } from "./memoryStore";
import { VectorMemory } from "./vectorMemory";
import { ConversationMemory } from "./conversationMemory";
import { ProjectMemory } from "./projectMemory";
import { WorkspaceMemory } from "./workspaceMemory";
import { eventBus } from "../events/eventBus";

export interface MemoryEntry {
  id: string;
  content: string;
  type: "conversation" | "project" | "workspace" | "general";
  timestamp: number;
  tags: string[];
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
}

export class MemoryManager {
  private store = new MemoryStore();
  private _vector = new VectorMemory();
  private conversations = new ConversationMemory();
  private projects = new ProjectMemory();
  private _workspaces = new WorkspaceMemory();
  private entries: MemoryEntry[] = [];

  constructor() {
    void this._vector;
    void this._workspaces;
  }

  async remember(
    content: string,
    type: MemoryEntry["type"] = "general",
    tags: string[] = []
  ): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      type,
      timestamp: Date.now(),
      tags,
    };

    this.entries.push(entry);
    this.store.add({ id: entry.id, content });

    eventBus.emit("memory:stored", { id: entry.id, type, tags });
    console.log(`[MemoryManager] Stored: [${type}] ${content.slice(0, 60)}...`);

    return entry;
  }

  search(query: string, limit = 5): SearchResult[] {
    const q = query.toLowerCase();

    const scored = this.entries.map(entry => {
      let score = 0;
      if (entry.content.toLowerCase().includes(q)) score += 2;
      entry.tags.forEach(tag => {
        if (tag.toLowerCase().includes(q)) score += 1;
      });
      return { entry, score };
    });

    const results = scored
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    console.log(`[MemoryManager] Search "${query}" — ${results.length} results`);
    eventBus.emit("memory:searched", { query, results: results.length });

    return results;
  }

  getByType(type: MemoryEntry["type"]): MemoryEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  getRecent(limit = 10): MemoryEntry[] {
    return [...this.entries]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  addConversation(role: "user" | "assistant", content: string) {
    this.conversations.add(content);
    this.remember(content, "conversation", [role]);
  }

  addProjectContext(projectId: string, context: string) {
    this.projects.add(context);
    this.remember(context, "project", [projectId]);
  }

  getConversationHistory() {
    return this.conversations.getAll();
  }

  clear() {
    this.entries = [];
    eventBus.emit("memory:cleared", { timestamp: Date.now() });
    console.log(`[MemoryManager] Cleared all memory`);
  }

  stats() {
    return {
      total: this.entries.length,
      byType: {
        conversation: this.getByType("conversation").length,
        project: this.getByType("project").length,
        workspace: this.getByType("workspace").length,
        general: this.getByType("general").length,
      },
    };
  }
}

export const memoryManager = new MemoryManager();