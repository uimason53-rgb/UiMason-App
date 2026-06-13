// ─────────────────────────────────────────────────────────────
// server/middleware/auth.ts
// JWT authentication middleware
// Extends Express Request with req.user for all protected routes
// ─────────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { isProduction } from "../env";

const DEV_JWT_SECRET = "uimason-dev-jwt-secret";
const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;

if (isProduction && JWT_SECRET === DEV_JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured in production.");
}

export interface AuthPayload {
  userId: string;
  email: string;
  plan: string;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// ── Generate tokens ──────────────────────────────────────────
export const generateAccessToken = (payload: AuthPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
};

export const generateRefreshToken = (payload: AuthPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
};

export const verifyToken = (token: string): AuthPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
};

// ── Auth middleware — injects req.user ───────────────────────
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!token) {
    return res.status(401).json({ error: "Missing authentication token" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = payload;
  next();
};
