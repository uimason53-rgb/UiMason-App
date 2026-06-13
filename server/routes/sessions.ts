// server/routes/sessions.ts
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { sessions, agentSessions } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

const router = Router();
router.use(authMiddleware);

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["file", "image", "folder"]),
  mimeType: z.string().optional(),
  dataUrl: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  fileCount: z.number().int().nonnegative().optional(),
  ext: z.string().optional(),
});

const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["assistant", "user"]),
  content: z.string(),
  attachments: z.array(attachmentSchema).optional(),
});

const createSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  messages: z.array(chatMessageSchema),
  createdAt: z.number(),
  workspaceId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  title: z.string().optional(),
  messages: z.array(chatMessageSchema).optional(),
  workspaceId: z.string().nullable().optional(),
});

// ── GET /api/sessions ────────────────────────────────────────
router.get("/", async (req, res) => {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, req.user!.userId))
    .orderBy(desc(sessions.createdAt));

  res.json(rows.map((r) => ({ ...r, messages: JSON.parse(r.messages || "[]") })));
});

// ── POST /api/sessions ───────────────────────────────────────
router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session data", details: parsed.error.flatten() });
  }

  const { id, title, messages, createdAt, workspaceId } = parsed.data;
  const now = Date.now();

  await db
    .insert(sessions)
    .values({
      id,
      userId: req.user!.userId,
      title,
      messages: JSON.stringify(messages),
      createdAt,
      updatedAt: now,
      workspaceId: workspaceId || null,
    })
    .onConflictDoUpdate({
      target: sessions.id,
      set: {
        title,
        messages: JSON.stringify(messages),
        updatedAt: now,
        workspaceId: workspaceId || null,
      },
    });

  res.json({ ok: true, updatedAt: now });
});

// ── PUT /api/sessions/:id ────────────────────────────────────
router.put("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session data", details: parsed.error.flatten() });
  }

  const existing = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, req.params.id), eq(sessions.userId, req.user!.userId)))
    .limit(1);

  if (existing.length === 0) {
    return res.status(404).json({ error: "Session not found" });
  }

  const now = Date.now();
  const updates: Record<string, unknown> = { updatedAt: now };

  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.messages !== undefined) updates.messages = JSON.stringify(parsed.data.messages);
  if (parsed.data.workspaceId !== undefined) updates.workspaceId = parsed.data.workspaceId;

  await db
    .update(sessions)
    .set(updates)
    .where(and(eq(sessions.id, req.params.id), eq(sessions.userId, req.user!.userId)));

  res.json({ ok: true, updatedAt: now });
});

// ── DELETE /api/sessions/:id ─────────────────────────────────
router.delete("/:id", async (req, res) => {
  await db
    .delete(agentSessions)
    .where(and(eq(agentSessions.sessionId, req.params.id), eq(agentSessions.userId, req.user!.userId)));

  await db
    .delete(sessions)
    .where(and(eq(sessions.id, req.params.id), eq(sessions.userId, req.user!.userId)));

  res.json({ ok: true });
});

export default router;