// ─────────────────────────────────────────────────────────────
// server/routes/auth.ts
// User registration, login, token refresh
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "crypto";
import db from "../db/index";
import { generateAccessToken, generateRefreshToken, verifyToken, authMiddleware } from "../middleware/auth";
import { generalRateLimiter } from "../middleware/rateLimiter";
import { isProduction } from "../env";

const router = Router();

// ── Validation schemas ───────────────────────────────────────
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

  // Check if user exists
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  const now = Date.now();

  db.prepare(
    "INSERT INTO users (id, email, passwordHash, plan, usageCount, usageLimit, createdAt, lastLogin) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id, email, passwordHash, "free", 0, 100, now, now);

  const payload = { userId: id, email, plan: "free" };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  res.status(201).json({
    user: { id, email, plan: "free" },
    accessToken,
    refreshToken,
  });
});

// ── POST /api/auth/login ─────────────────────────────────────
router.post("/login", generalRateLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as {
    id: string; email: string; passwordHash: string; plan: string;
  } | undefined;

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // Update lastLogin
  db.prepare("UPDATE users SET lastLogin = ? WHERE id = ?").run(Date.now(), user.id);

  const payload = { userId: user.id, email: user.email, plan: user.plan };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  res.json({
    user: { id: user.id, email: user.email, plan: user.plan },
    accessToken,
    refreshToken,
  });
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

  const newAccessToken = generateAccessToken(payload);
  const newRefreshToken = generateRefreshToken(payload);

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
});

// ── POST /api/auth/token (backward compat — auto-creates user) ─
router.post("/token", generalRateLimiter, async (req, res) => {
  if (isProduction) {
    return res.status(404).json({ error: "Development token endpoint is disabled in production" });
  }

  const email = "user@uimason.dev";
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as {
    id: string; email: string; plan: string;
  } | undefined;

  if (!user) {
    const passwordHash = await bcrypt.hash("uimason-auto", 12);
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO users (id, email, passwordHash, plan, usageCount, usageLimit, createdAt, lastLogin) VALUES (?,?,?,?,?,?,?,?)"
    ).run(id, email, passwordHash, "free", 0, 100, now, now);
    user = { id, email, plan: "free" };
  }

  const payload = { userId: user.id, email: user.email, plan: user.plan };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  res.json({ token: accessToken, refreshToken, user: { id: user.id, email: user.email, plan: user.plan } });
});

// ── GET /api/auth/me ─────────────────────────────────────────
router.get("/me", authMiddleware, (req, res) => {
  const user = db.prepare("SELECT id, email, plan, usageCount, usageLimit, createdAt, lastLogin FROM users WHERE id = ?").get(req.user!.userId) as Record<string, unknown> | undefined;
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json(user);
});

export default router;
