// server/routes/agentSessions.ts
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { agentSessions } from "../db/schema";
import { eq, and } from "drizzle-orm";
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
router.get("/:sessionId", async (req, res) => {
  const result = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.sessionId, req.params.sessionId), eq(agentSessions.userId, req.user!.userId)))
    .limit(1);

  if (result.length === 0) return res.json(null);

  const row = result[0];
  res.json({
    ...row,
    plan: row.plan ? JSON.parse(row.plan) : null,
    files: row.files ? JSON.parse(row.files) : [],
    logs: row.logs ? JSON.parse(row.logs) : [],
  });
});

// ── PUT /api/agent-sessions/:sessionId (upsert) ──────────────
router.put("/:sessionId", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid agent session data", details: parsed.error.flatten() });
  }

  const now = Date.now();
  const data = parsed.data;

  const existing = await db
    .select({ sessionId: agentSessions.sessionId })
    .from(agentSessions)
    .where(and(eq(agentSessions.sessionId, req.params.sessionId), eq(agentSessions.userId, req.user!.userId)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(agentSessions).values({
      sessionId: req.params.sessionId,
      userId: req.user!.userId,
      prompt: data.prompt || "",
      plan: data.plan !== undefined ? JSON.stringify(data.plan) : null,
      files: data.files !== undefined ? JSON.stringify(data.files) : "[]",
      logs: data.logs !== undefined ? JSON.stringify(data.logs) : "[]",
      state: data.state || "idle",
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const updates: Record<string, unknown> = { updatedAt: now };
    if (data.prompt !== undefined) updates.prompt = data.prompt;
    if (data.plan !== undefined) updates.plan = JSON.stringify(data.plan);
    if (data.files !== undefined) updates.files = JSON.stringify(data.files);
    if (data.logs !== undefined) updates.logs = JSON.stringify(data.logs);
    if (data.state !== undefined) updates.state = data.state;

    await db
      .update(agentSessions)
      .set(updates)
      .where(and(eq(agentSessions.sessionId, req.params.sessionId), eq(agentSessions.userId, req.user!.userId)));
  }

  res.json({ ok: true, updatedAt: now });
});

// ── DELETE /api/agent-sessions/:sessionId ────────────────────
router.delete("/:sessionId", async (req, res) => {
  await db
    .delete(agentSessions)
    .where(and(eq(agentSessions.sessionId, req.params.sessionId), eq(agentSessions.userId, req.user!.userId)));

  res.json({ ok: true });
});

export default router;