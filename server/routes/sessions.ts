// ─────────────────────────────────────────────────────────────
// server/routes/sessions.ts
// Session CRUD — scoped to authenticated user
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { z } from "zod";
import db from "../db/index";
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
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM sessions WHERE userId = ? ORDER BY createdAt DESC").all(req.user!.userId);
  res.json((rows as { messages: string }[]).map((r) => ({ ...r, messages: JSON.parse(r.messages || "[]") })));
});

// ── POST /api/sessions ───────────────────────────────────────
router.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session data", details: parsed.error.flatten() });
  }
  const { id, title, messages, createdAt, workspaceId } = parsed.data;
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO sessions (id, userId, title, messages, createdAt, updatedAt, workspaceId) VALUES (?,?,?,?,?,?,?)"
  ).run(id, req.user!.userId, title, JSON.stringify(messages), createdAt, now, workspaceId || null);
  res.json({ ok: true, updatedAt: now });
});

// ── PUT /api/sessions/:id ────────────────────────────────────
router.put("/:id", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session data", details: parsed.error.flatten() });
  }

  // Verify ownership
  const existing = db.prepare("SELECT id FROM sessions WHERE id = ? AND userId = ?").get(req.params.id, req.user!.userId);
  if (!existing) {
    return res.status(404).json({ error: "Session not found" });
  }

  const now = Date.now();
  if (parsed.data.title !== undefined) {
    db.prepare("UPDATE sessions SET title = ?, updatedAt = ? WHERE id = ? AND userId = ?").run(parsed.data.title, now, req.params.id, req.user!.userId);
  }
  if (parsed.data.messages !== undefined) {
    db.prepare("UPDATE sessions SET messages = ?, updatedAt = ? WHERE id = ? AND userId = ?").run(JSON.stringify(parsed.data.messages), now, req.params.id, req.user!.userId);
  }
  if (parsed.data.workspaceId !== undefined) {
    db.prepare("UPDATE sessions SET workspaceId = ?, updatedAt = ? WHERE id = ? AND userId = ?").run(parsed.data.workspaceId, now, req.params.id, req.user!.userId);
  }
  res.json({ ok: true, updatedAt: now });
});

// ── DELETE /api/sessions/:id ─────────────────────────────────
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM sessions WHERE id = ? AND userId = ?").run(req.params.id, req.user!.userId);
  db.prepare("DELETE FROM agent_sessions WHERE session_id = ? AND userId = ?").run(req.params.id, req.user!.userId);
  res.json({ ok: true });
});

export default router;