// server/routes/deployments.ts
import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { db } from "../db/client";
import { deployments } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

type ApiError = { error?: { message?: string }; message?: string; id?: string; deploy_ssl_url?: string; deploy_url?: string };

const router = Router();
router.use(authMiddleware);

const deploySchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  projectName: z.string().min(1).max(100),
});

const safeProjectSlug = (projectName: string) =>
  projectName.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "uimason-app";

const VALIDATION_CACHE_MS = 5 * 60 * 1000;
const tokenValidationCache = new Map<string, { expiresAt: number }>();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryableStatus = (status: number) => status === 429 || status >= 500;

const fetchWithRetry = async (url: string, init: RequestInit, retries = 2, backoffMs = 500): Promise<Response> => {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, init);
      if (!response.ok && isRetryableStatus(response.status) && attempt < retries) {
        attempt += 1;
        await delay(backoffMs * attempt);
        continue;
      }
      return response;
    } catch (error) {
      if (attempt >= retries) throw error;
      attempt += 1;
      await delay(backoffMs * attempt);
    }
  }
};

const readResponseText = async (response: Response): Promise<string> => {
  try { return await response.text(); } catch { return ""; }
};

const getCachedValidation = (cacheKey: string) => {
  const entry = tokenValidationCache.get(cacheKey);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) { tokenValidationCache.delete(cacheKey); return false; }
  return true;
};

const setCachedValidation = (cacheKey: string) => {
  tokenValidationCache.set(cacheKey, { expiresAt: Date.now() + VALIDATION_CACHE_MS });
};

const validateVercelToken = async (token: string, teamId?: string) => {
  const cacheKey = `vercel:${teamId || "default"}:${token}`;
  if (getCachedValidation(cacheKey)) return;
  const endpoint = `https://api.vercel.com/v1/user${teamId ? `?teamId=${teamId}` : ""}`;
  const response = await fetchWithRetry(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const message = await readResponseText(response);
    throw new Error(`Invalid Vercel token: ${response.status} ${message}`);
  }
  setCachedValidation(cacheKey);
};

const validateNetlifyToken = async (token: string) => {
  const cacheKey = `netlify:${token}`;
  if (getCachedValidation(cacheKey)) return;
  const response = await fetchWithRetry("https://api.netlify.com/api/v1/user", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const message = await readResponseText(response);
    throw new Error(`Invalid Netlify token: ${response.status} ${message}`);
  }
  setCachedValidation(cacheKey);
};

const crc32 = (buf: Buffer): number => {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xEDB88320;
      else crc >>>= 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const createZipFromFiles = (files: Array<{ path: string; content: string }>): Buffer => {
  const localFileHeader = (name: string, data: Buffer): Buffer => {
    const nameBuf = Buffer.from(name, "utf-8");
    const header = Buffer.alloc(30 + nameBuf.length);
    let offset = 0;
    header.writeUInt32LE(0x04034b50, offset); offset += 4;
    header.writeUInt16LE(20, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt32LE(crc32(data), offset); offset += 4;
    header.writeUInt32LE(data.length, offset); offset += 4;
    header.writeUInt32LE(data.length, offset); offset += 4;
    header.writeUInt16LE(nameBuf.length, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    nameBuf.copy(header, offset);
    return Buffer.concat([header, data]);
  };

  const centralDirEntry = (name: string, data: Buffer, localOffset: number): Buffer => {
    const nameBuf = Buffer.from(name, "utf-8");
    const entry = Buffer.alloc(46 + nameBuf.length);
    let offset = 0;
    entry.writeUInt32LE(0x02014b50, offset); offset += 4;
    entry.writeUInt16LE(20, offset); offset += 2;
    entry.writeUInt16LE(20, offset); offset += 2;
    entry.writeUInt16LE(0, offset); offset += 2;
    entry.writeUInt16LE(0, offset); offset += 2;
    entry.writeUInt32LE(crc32(data), offset); offset += 4;
    entry.writeUInt32LE(data.length, offset); offset += 4;
    entry.writeUInt32LE(data.length, offset); offset += 4;
    entry.writeUInt16LE(nameBuf.length, offset); offset += 2;
    entry.writeUInt16LE(0, offset); offset += 2;
    entry.writeUInt16LE(0, offset); offset += 2;
    entry.writeUInt16LE(0, offset); offset += 2;
    entry.writeUInt16LE(0, offset); offset += 2;
    entry.writeUInt32LE(0, offset); offset += 4;
    entry.writeUInt32LE(localOffset, offset); offset += 4;
    nameBuf.copy(entry, offset);
    return entry;
  };

  const eocd = (entries: number, cdSize: number, cdOffset: number): Buffer => {
    const buf = Buffer.alloc(22);
    let off = 0;
    buf.writeUInt32LE(0x06054b50, off); off += 4;
    buf.writeUInt16LE(0, off); off += 2;
    buf.writeUInt16LE(0, off); off += 2;
    buf.writeUInt16LE(entries, off); off += 2;
    buf.writeUInt16LE(entries, off); off += 2;
    buf.writeUInt32LE(cdSize, off); off += 4;
    buf.writeUInt32LE(cdOffset, off); off += 4;
    buf.writeUInt16LE(0, off);
    return buf;
  };

  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;

  for (const file of files) {
    const data = Buffer.from(file.content, "utf-8");
    const local = localFileHeader(file.path, data);
    localEntries.push(local);
    centralEntries.push(centralDirEntry(file.path, data, localOffset));
    localOffset += local.length;
  }

  const cdBuffer = Buffer.concat(centralEntries);
  return Buffer.concat([...localEntries, cdBuffer, eocd(files.length, cdBuffer.length, localOffset)]);
};

const deployToVercel = async (files: Array<{ path: string; content: string }>, projectName: string): Promise<{ url: string; deploymentId: string; logs: string[] }> => {
  const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "";
  const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "";
  if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN environment variable is not configured");

  const logs: string[] = [];
  const slug = safeProjectSlug(projectName);
  const teamParam = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : "";
  const payload = {
    name: slug, target: "production",
    files: files.map((f) => ({ file: f.path, data: Buffer.from(f.content, "utf-8").toString("base64") })),
    projectSettings: { framework: null, buildCommand: "npm run build", outputDirectory: "dist", installCommand: "npm install --no-audit --no-fund" },
  };

  await validateVercelToken(VERCEL_TOKEN, VERCEL_TEAM_ID);
  const createRes = await fetch(`https://api.vercel.com/v13/deployments${teamParam}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({} as ApiError));
    throw new Error(`Vercel deployment failed: ${err.error?.message || err.message || createRes.status}`);
  }

  const deployment = await createRes.json() as { id?: string; url?: string };
  const deploymentId = deployment.id ?? "";
  const url = deployment.url ? (deployment.url.startsWith("http") ? deployment.url : `https://${deployment.url}`) : `https://${slug}.vercel.app`;
  logs.push(`Deployment created: ${deploymentId}`);
  logs.push(`Deployment URL: ${url}`);
  return { url, deploymentId, logs };
};

const deployToNetlify = async (files: Array<{ path: string; content: string }>, projectName: string): Promise<{ url: string; deploymentId: string; logs: string[] }> => {
  const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN || "";
  const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID || "";
  if (!NETLIFY_TOKEN) throw new Error("NETLIFY_TOKEN environment variable is not configured");

  const logs: string[] = [];
  const zipBuffer = createZipFromFiles(files);
  await validateNetlifyToken(NETLIFY_TOKEN);

  const siteId = NETLIFY_SITE_ID || "";
  let deployUrl = `https://api.netlify.com/api/v1/sites/${siteId}/deploys`;

  if (!siteId) {
    const siteSlug = safeProjectSlug(projectName);
    const siteRes = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: siteSlug, custom_domain: null }),
    });
    if (!siteRes.ok) {
      const err = await siteRes.json().catch(() => ({} as ApiError));
      throw new Error(`Netlify site creation failed: ${err.message || err.error?.message || siteRes.status}`);
    }
    const site = await siteRes.json() as { id?: string };
    deployUrl = `https://api.netlify.com/api/v1/sites/${site.id ?? ""}/deploys`;
    logs.push(`Site created: ${site.id ?? "unknown"}`);
  }

  const deployRes = await fetch(deployUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, "Content-Type": "application/zip" },
    body: zipBuffer as unknown as BodyInit,
  });
  if (!deployRes.ok) {
    const err = await deployRes.json().catch(() => ({} as ApiError));
    throw new Error(`Netlify deployment failed: ${err.message || deployRes.status}`);
  }

  const deploy = await deployRes.json() as ApiError;
  const url = deploy.deploy_ssl_url || deploy.deploy_url || "";
  const deploymentId = deploy.id ?? "";
  logs.push(`Deployment created: ${deploymentId}`);
  if (url) logs.push(`Deploy URL: ${url}`);
  return { url, deploymentId, logs };
};

// ── Routes ───────────────────────────────────────────────────

router.post("/deploy/vercel", async (req, res) => {
  const parsed = deploySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid deploy data", details: parsed.error.flatten() });

  const { files, projectName } = parsed.data;
  try {
    const result = await deployToVercel(files, projectName);
    await db.insert(deployments).values({
      id: crypto.randomUUID(),
      userId: req.user!.userId,
      projectName,
      provider: "vercel",
      deploymentUrl: result.url,
      status: "live",
      createdAt: Date.now(),
    });
    res.json({ success: true, url: result.url, deploymentId: result.deploymentId, provider: "vercel", status: "live", logs: result.logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vercel deploy failed";
    res.status(500).json({ error: message, success: false, url: "", deploymentId: "", provider: "vercel", status: "error", logs: [message] });
  }
});

router.post("/deploy/netlify", async (req, res) => {
  const parsed = deploySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid deploy data", details: parsed.error.flatten() });

  const { files, projectName } = parsed.data;
  try {
    const result = await deployToNetlify(files, projectName);
    await db.insert(deployments).values({
      id: crypto.randomUUID(),
      userId: req.user!.userId,
      projectName,
      provider: "netlify",
      deploymentUrl: result.url,
      status: "live",
      createdAt: Date.now(),
    });
    res.json({ success: true, url: result.url, deploymentId: result.deploymentId, provider: "netlify", status: "live", logs: result.logs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Netlify deploy failed";
    res.status(500).json({ error: message, success: false, url: "", deploymentId: "", provider: "netlify", status: "error", logs: [message] });
  }
});

router.get("/deployments", async (req, res) => {
  const rows = await db
    .select({ id: deployments.id, projectName: deployments.projectName, provider: deployments.provider, deploymentUrl: deployments.deploymentUrl, status: deployments.status, createdAt: deployments.createdAt })
    .from(deployments)
    .where(eq(deployments.userId, req.user!.userId))
    .orderBy(desc(deployments.createdAt))
    .limit(50);
  res.json(rows);
});

router.delete("/deployments/:id", async (req, res) => {
  await db.delete(deployments).where(and(eq(deployments.id, req.params.id), eq(deployments.userId, req.user!.userId)));
  res.json({ ok: true });
});

export default router;