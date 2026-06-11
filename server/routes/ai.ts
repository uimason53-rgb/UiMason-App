// ─────────────────────────────────────────────────────────────
// server/routes/ai.ts
// AI proxy routes — all provider streaming + non-streaming
// Scoped to authenticated user with usage tracking
// ─────────────────────────────────────────────────────────────
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import db from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { aiRateLimiter } from "../middleware/rateLimiter";

const router = Router();
router.use(authMiddleware);
router.use(aiRateLimiter);

// ── Environment variables ────────────────────────────────────
const DEEPSEEK_KEY: string = process.env.DEEPSEEK_KEY || "";
const CLAUDE_KEY: string = process.env.CLAUDE_KEY || "";
const OPENAI_KEY: string = process.env.OPENAI_KEY || "";
const GEMINI_KEY: string = process.env.GEMINI_KEY || "";
const BRAIN_MODEL = "gpt-5.5";
const BUILDER_MODEL = "deepseek-v4-pro";

// ── Zod schemas ──────────────────────────────────────────────
const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.union([z.string(), z.null()]),
  name: z.string().optional(),
  tool_calls: z.array(z.unknown()).optional(),
  tool_call_id: z.string().optional(),
});

const deepseekChatSchema = z.object({
  model: z.string().optional(),
  messages: z.array(chatMessageSchema).min(1),
  max_tokens: z.number().int().positive().max(32000).optional().default(8000),
  temperature: z.number().min(0).max(2).optional().default(0.3),
  tools: z.array(z.unknown()).optional(),
});

const claudeChatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.union([z.string(), z.array(z.unknown())]),
    })
  ).min(1),
  system: z.string().optional(),
  max_tokens: z.number().int().positive().max(32000).optional().default(8000),
  temperature: z.number().min(0).max(1).optional().default(0.3),
  tools: z.array(z.unknown()).optional(),
  provider: z.enum(["claude", "gemini"]).optional().default("claude"),
});

const openaiChatSchema = z.object({
  model: z.string().optional(),
  system: z.string().optional(),
  messages: z.array(chatMessageSchema).min(1),
  max_tokens: z.number().int().positive().max(32000).optional().default(8000),
  temperature: z.number().min(0).max(2).optional().default(0.3),
});

// ── Usage tracking middleware ────────────────────────────────
const trackUsage = (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user!.userId;
  try {
    const user = db.prepare("SELECT plan, usageCount, usageLimit FROM users WHERE id = ?").get(userId) as { plan: string; usageCount: number; usageLimit: number } | undefined;
    if (user) {
      if (user.usageCount >= user.usageLimit) {
        return res.status(429).json({
          error: `Usage limit reached (${user.usageCount}/${user.usageLimit}). Upgrade to Pro for unlimited access.`,
          plan: user.plan,
          usageCount: user.usageCount,
          usageLimit: user.usageLimit,
        });
      }
      db.prepare("UPDATE users SET usageCount = usageCount + 1 WHERE id = ?").run(userId);
    }
  } catch (error) {
    console.warn("Usage tracking failed", error);
  }
  next();
};

// ── Provider config ──────────────────────────────────────────
const PROVIDER_CONFIG = {
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    headers: (key: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${key}` }),
    key: () => DEEPSEEK_KEY,
    name: "DeepSeek",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    headers: (key: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${key}` }),
    key: () => OPENAI_KEY,
    name: "OpenAI",
  },
  claude: {
    url: "https://api.anthropic.com/v1/messages",
    headers: (key: string) => ({
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    key: () => CLAUDE_KEY,
    name: "Claude",
  },
  gemini: {
    url: (key: string) =>
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?alt=sse&key=${key}`,
    headers: () => ({ "Content-Type": "application/json" }),
    key: () => GEMINI_KEY,
    name: "Gemini",
  },
};

type ProviderName = keyof typeof PROVIDER_CONFIG;

const extractGeminiText = (parsed: unknown): string => {
  const c = parsed as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return c?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
};

const normalizeModelForProvider = (provider: ProviderName, body: Record<string, unknown>): Record<string, unknown> => {
  if (provider === "openai") {
    const { max_tokens, temperature, ...rest } = body;
    void temperature;
    return {
      ...rest,
      model: BRAIN_MODEL,
      max_completion_tokens: typeof max_tokens === "number" ? max_tokens : 8000,
    };
  }
  if (provider === "deepseek") return { ...body, model: BUILDER_MODEL };
  return body;
};

// ── Streaming proxy ──────────────────────────────────────────
const proxyStream = async (provider: ProviderName, body: Record<string, unknown>, res: Response) => {
  const config = PROVIDER_CONFIG[provider];
  const apiKey = config.key();
  if (!apiKey) return res.status(401).json({ error: `No ${config.name} API key configured` });

  const url = typeof config.url === "function" ? config.url(apiKey) : config.url;
  let upstreamBody: unknown = normalizeModelForProvider(provider, body);

  if (provider === "deepseek" || provider === "openai" || provider === "claude") {
    upstreamBody = { ...(upstreamBody as Record<string, unknown>), stream: true };
    if (provider === "openai" && typeof body.system === "string") {
      upstreamBody = {
        ...upstreamBody,
        messages: [
          { role: "system", content: body.system },
          ...((body.messages as unknown[]) || []),
        ],
      };
      delete (upstreamBody as Record<string, unknown>).system;
    }
  } else if (provider === "gemini") {
    const msgs = body.messages as Array<{ role: string; content: string }> | undefined;
    const sysMsg = body.system as string | undefined;
    upstreamBody = {
      contents: msgs?.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: sysMsg && m.role === "user" ? `${sysMsg}\n\n${m.content}` : m.content }],
      })) || [],
      generationConfig: { maxOutputTokens: body.max_tokens || 8192, temperature: body.temperature || 0.3 },
    };
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "POST", headers: config.headers(apiKey) as Record<string, string>, body: JSON.stringify(upstreamBody) });
  } catch (error) {
    console.error(`${config.name} connection error`, error);
    return res.status(502).json({ error: `${config.name} connection error` });
  }

  if (!upstream.ok) {
    let errMsg = `${config.name} returned ${upstream.status}`;
    try { const e = await upstream.json() as { error?: { message?: string } }; errMsg = e?.error?.message || errMsg; } catch (error) { console.warn("Failed to parse upstream error body", error); }
    return res.status(upstream.status).json({ error: errMsg });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = upstream.body?.getReader();
  if (!reader) return res.status(500).json({ error: "No upstream body" });

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim() && provider === "gemini") {
          for (const line of buffer.split("\n").filter((l) => l.trim())) {
            try { const text = extractGeminiText(JSON.parse(line)); if (text) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); } catch (error) { console.debug("Gemini stream fragment parse failed", error); }
          }
        }
        res.write("data: [DONE]\n\n");
        res.end();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      if (provider === "gemini") {
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try { const text = extractGeminiText(JSON.parse(line.trim())); if (text) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`); } catch (error) { console.debug("Gemini stream fragment parse failed", error); }
        }
      } else if (provider === "claude") {
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          if (t.startsWith("data:")) {
            try {
              const p = JSON.parse(t.slice(5).trim()) as { type: string; delta?: { text?: string } };
              if (p.type === "content_block_delta" && p.delta?.text) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p.delta.text } }] })}\n\n`); continue; }
              if (p.type === "message_stop") { res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`); res.write("data: [DONE]\n\n"); continue; }
            } catch (error) { console.debug("Claude stream parse failed", error); }
            res.write(t + "\n");
          } else if (t.startsWith("event:")) { res.write(t + "\n"); }
        }
      } else {
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) res.write(line + "\n");
      }
    }
  } catch (error) {
    console.error("Stream error", error);
    res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
};

// ── Non-streaming proxy ─────────────────────────────────────
const proxyNonStream = async (provider: ProviderName, body: Record<string, unknown>, res: Response) => {
  const config = PROVIDER_CONFIG[provider];
  const apiKey = config.key();
  if (!apiKey) return res.status(401).json({ error: `No ${config.name} API key configured` });

  const url = typeof config.url === "function" ? config.url(apiKey) : config.url;
  const upstreamBody: Record<string, unknown> = { ...normalizeModelForProvider(provider, body), stream: false };
  if (provider === "openai" && typeof body.system === "string") {
    upstreamBody.messages = [
      { role: "system", content: body.system },
      ...((body.messages as unknown[]) || []),
    ];
    delete upstreamBody.system;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url as string, { method: "POST", headers: config.headers(apiKey) as Record<string, string>, body: JSON.stringify(upstreamBody) });
  } catch (error) {
    console.error(`${config.name} connection error`, error);
    return res.status(502).json({ error: `${config.name} connection error` });
  }

  if (!upstream.ok) {
    let errMsg = `${config.name} returned ${upstream.status}`;
    try {
      const payload = await upstream.json();
      errMsg = payload?.error?.message || payload?.message || errMsg;
    } catch (error) {
      console.warn("Failed to parse upstream error body", error);
    }
    return res.status(upstream.status).json({ error: errMsg });
  }

  const data = await upstream.json();
  res.json(data);
};

// ═════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════

router.get("/ai/status", (_req, res) => {
  res.json({
    brain: {
      provider: "openai",
      model: BRAIN_MODEL,
      configured: Boolean(OPENAI_KEY),
    },
    builder: {
      provider: "deepseek",
      model: BUILDER_MODEL,
      configured: Boolean(DEEPSEEK_KEY),
    },
    optionalProviders: {
      claude: Boolean(CLAUDE_KEY),
      gemini: Boolean(GEMINI_KEY),
    },
  });
});

router.post("/deepseek/chat", trackUsage, (req, res) => {
  const parsed = deepseekChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  proxyStream("deepseek", parsed.data as Record<string, unknown>, res);
});

router.post("/claude/chat", trackUsage, (req, res) => {
  const parsed = claudeChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  const provider = parsed.data.provider === "gemini" ? "gemini" : "claude";
  proxyStream(provider, parsed.data as Record<string, unknown>, res);
});

router.post("/gemini/chat", trackUsage, (req, res) => {
  const parsed = claudeChatSchema.safeParse({ ...req.body, provider: "gemini" });
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  proxyStream("gemini", parsed.data as Record<string, unknown>, res);
});

router.post("/openai/chat", trackUsage, (req, res) => {
  const parsed = openaiChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  proxyNonStream("openai", parsed.data as Record<string, unknown>, res);
});

router.post("/openai/stream", trackUsage, (req, res) => {
  const parsed = openaiChatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  proxyStream("openai", parsed.data as Record<string, unknown>, res);
});

export default router;
