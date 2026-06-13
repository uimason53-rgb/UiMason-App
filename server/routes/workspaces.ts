// server/routes/workspaces.ts
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { workspaces } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
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
router.get("/", async (req, res) => {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, req.user!.userId))
    .orderBy(desc(workspaces.createdAt));

  res.json(rows.map((r) => ({ ...r, tree: JSON.parse(r.tree || "[]") })));
});

// ── GET /api/workspaces/:id ──────────────────────────────────
router.get("/:id", async (req, res) => {
  const result = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, req.params.id), eq(workspaces.userId, req.user!.userId)))
    .limit(1);

  if (result.length === 0) return res.json(null);

  const row = result[0];
  res.json({ ...row, tree: JSON.parse(row.tree || "[]") });
});

// ── POST /api/workspaces ─────────────────────────────────────
router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid workspace data", details: parsed.error.flatten() });
  }

  const { id, name, tree, createdAt } = parsed.data;
  const now = Date.now();

  await db
    .insert(workspaces)
    .values({
      id,
      userId: req.user!.userId,
      name,
      tree: JSON.stringify(tree),
      createdAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaces.id,
      set: {
        name,
        tree: JSON.stringify(tree),
        updatedAt: now,
      },
    });

  res.json({ ok: true, updatedAt: now });
});

// ── PUT /api/workspaces/:id ──────────────────────────────────
router.put("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid workspace data", details: parsed.error.flatten() });
  }

  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, req.params.id), eq(workspaces.userId, req.user!.userId)))
    .limit(1);

  if (existing.length === 0) return res.status(404).json({ error: "Workspace not found" });

  const now = Date.now();
  const updates: Record<string, unknown> = { updatedAt: now };

  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.tree !== undefined) updates.tree = JSON.stringify(parsed.data.tree);

  await db
    .update(workspaces)
    .set(updates)
    .where(and(eq(workspaces.id, req.params.id), eq(workspaces.userId, req.user!.userId)));

  res.json({ ok: true, updatedAt: now });
});

// ── DELETE /api/workspaces/:id ───────────────────────────────
router.delete("/:id", async (req, res) => {
  await db
    .delete(workspaces)
    .where(and(eq(workspaces.id, req.params.id), eq(workspaces.userId, req.user!.userId)));

  res.json({ ok: true });
});

export default router;