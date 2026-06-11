// ─────────────────────────────────────────────────────────────
// server/routes/agentSessions.ts
// Agent session CRUD — scoped to authenticated user
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { z } from "zod";
import db from "../db/index";
import { authMiddleware } from "../middleware/auth";

const router = Router();
router.use(authMiddleware);

const updateSchema = z.object({
  prompt: z.string().optional(),
  plan: z.any().nullable().optional(),
  files: z.any().optional(),
  logs: z.any().optional(),
  state: z.enum(["idle", "planning", "generating", "fixing", "done", "error"]).optional(),
});

// ── GET /api/agent-sessions/:sessionId ───────────────────────
router.get("/:sessionId", (req, res) => {
  const row = db.prepare(
    "SELECT * FROM agent_sessions WHERE session_id = ? AND userId = ?"
  ).get(req.params.sessionId, req.user!.userId) as Record<string, unknown> | undefined;

  if (!row) {
    return res.json(null);
  }
  res.json({
    ...row,
    plan: row.plan ? JSON.parse(row.plan as string) : null,
    files: row.files ? JSON.parse(row.files as string) : [],
    logs: row.logs ? JSON.parse(row.logs as string) : [],
  });
});

// ── PUT /api/agent-sessions/:sessionId (upsert) ──────────────
router.put("/:sessionId", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid agent session data", details: parsed.error.flatten() });
  }

  const now = Date.now();
  const data = parsed.data;
  const existing = db.prepare(
    "SELECT session_id FROM agent_sessions WHERE session_id = ? AND userId = ?"
  ).get(req.params.sessionId, req.user!.userId);

  if (!existing) {
    db.prepare(
      "INSERT INTO agent_sessions (session_id, userId, prompt, plan, files, logs, state, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(
      req.params.sessionId,
      req.user!.userId,
      data.prompt || "",
      data.plan !== undefined ? JSON.stringify(data.plan) : null,
      data.files !== undefined ? JSON.stringify(data.files) : "[]",
      data.logs !== undefined ? JSON.stringify(data.logs) : "[]",
      data.state || "idle",
      now,
      now
    );
  } else {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (data.prompt !== undefined) { fields.push("prompt = ?"); values.push(data.prompt); }
    if (data.plan !== undefined) { fields.push("plan = ?"); values.push(JSON.stringify(data.plan)); }
    if (data.files !== undefined) { fields.push("files = ?"); values.push(JSON.stringify(data.files)); }
    if (data.logs !== undefined) { fields.push("logs = ?"); values.push(JSON.stringify(data.logs)); }
    if (data.state !== undefined) { fields.push("state = ?"); values.push(data.state); }
    fields.push("updatedAt = ?");
    values.push(now);
    values.push(req.params.sessionId);
    values.push(req.user!.userId);
    db.prepare(`UPDATE agent_sessions SET ${fields.join(", ")} WHERE session_id = ? AND userId = ?`).run(...values);
  }

  res.json({ ok: true, updatedAt: now });
});

// ── DELETE /api/agent-sessions/:sessionId ────────────────────
router.delete("/:sessionId", (req, res) => {
  db.prepare("DELETE FROM agent_sessions WHERE session_id = ? AND userId = ?").run(req.params.sessionId, req.user!.userId);
  res.json({ ok: true });
});

export default router;