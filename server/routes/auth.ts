// server/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "crypto";
import { db } from "../db/client";
import { users, refreshTokens } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateAccessToken, generateRefreshToken, verifyToken, authMiddleware } from "../middleware/auth";
import { generalRateLimiter } from "../middleware/rateLimiter";
import { isProduction } from "../env";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── POST /api/auth/register ──────────────────────────────────
router.post("/register", generalRateLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  const now = Date.now();

  await db.insert(users).values({ id, email, passwordHash, plan: "free", usageCount: 0, usageLimit: 100, createdAt: now, lastLogin: now });

  const payload = { userId: id, email, plan: "free" };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId: id,
    tokenHash: crypto.createHash("sha256").update(refreshToken).digest("hex"),
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    createdAt: now,
  });

  res.status(201).json({ user: { id, email, plan: "free" }, accessToken, refreshToken });
});

// ── POST /api/auth/login ─────────────────────────────────────
router.post("/login", generalRateLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = result[0];

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const now = Date.now();
  await db.update(users).set({ lastLogin: now }).where(eq(users.id, user.id));

  const payload = { userId: user.id, email: user.email, plan: user.plan };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: crypto.createHash("sha256").update(refreshToken).digest("hex"),
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    createdAt: now,
  });

  res.json({ user: { id: user.id, email: user.email, plan: user.plan }, accessToken, refreshToken });
});

// ── POST /api/auth/refresh ───────────────────────────────────
router.post("/refresh", generalRateLimiter, async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    return res.status(400).json({ error: "Missing refresh token" });
  }

  const payload = verifyToken(refreshToken);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  // Verify token exists in DB (not revoked)
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const stored = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);
  if (stored.length === 0) {
    return res.status(401).json({ error: "Refresh token revoked" });
  }

  // Rotate — delete old, issue new
  await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));

  const now = Date.now();
  const newAccessToken = generateAccessToken(payload);
  const newRefreshToken = generateRefreshToken(payload);

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId: payload.userId,
    tokenHash: crypto.createHash("sha256").update(newRefreshToken).digest("hex"),
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    createdAt: now,
  });

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
});

// ── POST /api/auth/logout ────────────────────────────────────
router.post("/logout", async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (refreshToken) {
    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
  }
  res.json({ ok: true });
});

// ── POST /api/auth/token (dev only) ─────────────────────────
router.post("/token", generalRateLimiter, async (_req, res) => {
  if (isProduction) {
    return res.status(404).json({ error: "Development token endpoint is disabled in production" });
  }

  const email = "user@uimason.dev";
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let user = result[0];

  if (!user) {
    const passwordHash = await bcrypt.hash("uimason-auto", 12);
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.insert(users).values({ id, email, passwordHash, plan: "free", usageCount: 0, usageLimit: 100, createdAt: now, lastLogin: now });
    const fresh = await db.select().from(users).where(eq(users.id, id)).limit(1);
    user = fresh[0];
  }

  const payload = { userId: user.id, email: user.email, plan: user.plan };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  res.json({ token: accessToken, refreshToken, user: { id: user.id, email: user.email, plan: user.plan } });
});

// ── GET /api/auth/me ─────────────────────────────────────────
router.get("/me", authMiddleware, async (req, res) => {
  const result = await db.select({
    id: users.id,
    email: users.email,
    plan: users.plan,
    usageCount: users.usageCount,
    usageLimit: users.usageLimit,
    createdAt: users.createdAt,
    lastLogin: users.lastLogin,
  }).from(users).where(eq(users.id, req.user!.userId)).limit(1);

  if (result.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json(result[0]);
});

export default router;