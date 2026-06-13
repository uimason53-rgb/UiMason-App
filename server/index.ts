// server/index.ts — UiMason SaaS Backend
import "./env";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import sessionRoutes from "./routes/sessions";
import agentSessionRoutes from "./routes/agentSessions";
import workspaceRoutes from "./routes/workspaces";
import aiRoutes from "./routes/ai";
import deployRoutes from "./routes/deployments";
import sandboxRoutes from "./routes/sandbox";
import githubRoutes from "./routes/github";

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const app = express();

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "10mb" }));

// ── Health check ─────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "5.0.0", mode: "multi-user", db: "postgresql" });
});

// ── Routes ───────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/agent-sessions", agentSessionRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api", aiRoutes);
app.use("/api", deployRoutes);
app.use("/api", sandboxRoutes);
app.use("/api", githubRoutes);

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[UiMason] Backend running on :${PORT}`);
  console.log(`[CORS]    Origin: ${CORS_ORIGIN}`);
  console.log(`[DB]      PostgreSQL via Drizzle ORM`);
  console.log(`[Auth]    JWT + refresh token rotation`);
});