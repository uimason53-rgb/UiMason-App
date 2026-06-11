// ─────────────────────────────────────────────────────────────
// server/env.ts
// Dotenv preload — must be imported FIRST so all subsequent
// module-level constants can read process.env
// ─────────────────────────────────────────────────────────────
import { config } from "dotenv";
config();

export const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured in production.");
}

if (!isProduction && !process.env.JWT_SECRET) {
  console.warn("[env] JWT_SECRET is not set. Using development-only fallback secret.");
}
