// server/services/tools/audit/toolAuditLogger.ts
import { db } from "../../../db/client";
import { sql } from "drizzle-orm";
import { pgTable, text, integer, bigint, index } from "drizzle-orm/pg-core";

// ── Inline table definition (tool_audit_log) ─────────────────
export const toolAuditLog = pgTable("tool_audit_log", {
  id:         text("id").primaryKey(),
  userId:     text("user_id"),
  sessionId:  text("session_id"),
  toolName:   text("tool_name").notNull(),
  args:       text("args").notNull().default("{}"),
  success:    integer("success").notNull(),
  result:     text("result"),
  error:      text("error"),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt:  bigint("created_at", { mode: "number" }).notNull(),
}, (t) => [
  index("tool_audit_session_idx").on(t.sessionId),
]);

export interface ToolAuditEntry {
  userId?: string;
  sessionId?: string;
  toolName: string;
  args: unknown;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

function safeStringify(value: unknown, maxLen = 4000): string {
  try {
    const str = JSON.stringify(value ?? null);
    return str.length > maxLen ? str.slice(0, maxLen) + "...(truncated)" : str;
  } catch {
    return "[unserializable]";
  }
}

export const toolAuditLogger = {
  async log(entry: ToolAuditEntry) {
    await db.insert(toolAuditLog).values({
      id: crypto.randomUUID(),
      userId: entry.userId ?? null,
      sessionId: entry.sessionId ?? null,
      toolName: entry.toolName,
      args: safeStringify(entry.args),
      success: entry.success ? 1 : 0,
      result: entry.result !== undefined ? safeStringify(entry.result) : null,
      error: entry.error ?? null,
      durationMs: entry.durationMs,
      createdAt: Date.now(),
    });
  },

  async recent(limit = 50) {
    return db.select().from(toolAuditLog)
      .orderBy(sql`created_at DESC`)
      .limit(limit);
  },

  async forSession(sessionId: string, limit = 100) {
    const { eq } = await import("drizzle-orm");
    return db.select().from(toolAuditLog)
      .where(eq(toolAuditLog.sessionId, sessionId))
      .orderBy(sql`created_at DESC`)
      .limit(limit);
  },
};