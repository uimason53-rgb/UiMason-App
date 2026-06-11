// ─────────────────────────────────────────────────────────────
// server/middleware/rateLimiter.ts
// Per-user rate limiting (replaces IP-based)
// ─────────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from "express";

interface RateEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

export const createUserRateLimiter = (maxRequests: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.userId || req.ip || "anonymous";
    const key = `${userId}:${maxRequests}:${windowMs}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      return res.status(429).json({
        error: "Too many requests. Please wait a moment and try again.",
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }

    next();
  };
};

// ── Pre-configured limiters ──────────────────────────────────
export const aiRateLimiter = createUserRateLimiter(100, 60 * 1000); // 100 AI req/min per user
export const generalRateLimiter = createUserRateLimiter(200, 60 * 1000); // 200 general req/min