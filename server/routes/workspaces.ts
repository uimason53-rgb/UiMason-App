// ─────────────────────────────────────────────────────────────
// server/routes/workspaces.ts
// Workspace CRUD — scoped to authenticated user
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { z } from "zod";
import db from "../db/index";
import { authMiddleware } from "../middleware/auth";

const router = Router();
router.use(authMiddleware);

const workspaceNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "folder"]),
    content: z.string().optional(),
    children: z.array(workspaceNodeSchema).optional(),
  })
);

const createSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  tree: z.array(workspaceNodeSchema),
  createdAt: z.number(),
});

const updateSchema = z.object({
  name: z.string().optional(),
  tree: z.array(workspaceNodeSchema).optional(),
});

// ── GET /api/workspaces ──────────────────────────────────────
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM workspaces WHERE userId = ? ORDER BY createdAt DESC").all(req.user!.userId);
  res.json((rows as { tree: string }[]).map((r) => ({ ...r, tree: JSON.parse(r.tree || "[]") })));
});

// ── GET /api/workspaces/:id ──────────────────────────────────
router.get("/:id", (req, res) => {
  const row = db.prepare(
    "SELECT * FROM workspaces WHERE id = ? AND userId = ?"
  ).get(req.params.id, req.user!.userId) as Record<string, unknown> | undefined;
  if (!row) return res.json(null);
  res.json({ ...row, tree: JSON.parse((row.tree as string) || "[]") });
});

// ── POST /api/workspaces ─────────────────────────────────────
router.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid workspace data", details: parsed.error.flatten() });
  }
  const { id, name, tree, createdAt } = parsed.data;
  const now = Date.now();
  db.prepare("INSERT OR REPLACE INTO workspaces (id, userId, name, tree, createdAt, updatedAt) VALUES (?,?,?,?,?,?)").run(
    id, req.user!.userId, name, JSON.stringify(tree), createdAt, now
  );
  res.json({ ok: true, updatedAt: now });
});

// ── PUT /api/workspaces/:id ──────────────────────────────────
router.put("/:id", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid workspace data", details: parsed.error.flatten() });
  }
  const existing = db.prepare("SELECT id FROM workspaces WHERE id = ? AND userId = ?").get(req.params.id, req.user!.userId);
  if (!existing) return res.status(404).json({ error: "Workspace not found" });

  const now = Date.now();
  if (parsed.data.name !== undefined) {
    db.prepare("UPDATE workspaces SET name = ?, updatedAt = ? WHERE id = ? AND userId = ?").run(parsed.data.name, now, req.params.id, req.user!.userId);
  }
  if (parsed.data.tree !== undefined) {
    db.prepare("UPDATE workspaces SET tree = ?, updatedAt = ? WHERE id = ? AND userId = ?").run(JSON.stringify(parsed.data.tree), now, req.params.id, req.user!.userId);
  }
  res.json({ ok: true, updatedAt: now });
});

// ── DELETE /api/workspaces/:id ───────────────────────────────
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM workspaces WHERE id = ? AND userId = ?").run(req.params.id, req.user!.userId);
  res.json({ ok: true });
});

export default router;