import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import {
  createSandboxJob,
  getSandboxJob,
  subscribeSandboxJob,
  type SandboxCommandName,
  type SandboxStreamEvent,
} from "../services/sandboxRunner";

const router = Router();
router.use(authMiddleware);

const commandSchema = z.enum(["install", "build", "lint", "test"]);

const fileSchema = z.object({
  path: z.string().min(1).max(260),
  content: z.string().max(1024 * 1024),
});

const createJobSchema = z.object({
  files: z.array(fileSchema).min(1).max(400),
  commands: z.array(commandSchema).optional(),
  timeoutMs: z.number().int().min(5_000).max(300_000).optional(),
});

const writeEvent = (res: import("express").Response, event: SandboxStreamEvent | { type: "log"; line: string }) => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

router.post("/sandbox/jobs", (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid sandbox job", details: parsed.error.flatten() });
  }

  const job = createSandboxJob(req.user!.userId, parsed.data.files, {
    commands: parsed.data.commands as SandboxCommandName[] | undefined,
    timeoutMs: parsed.data.timeoutMs,
  });
  res.status(202).json(job);
});

router.get("/sandbox/jobs/:jobId", (req, res) => {
  const job = getSandboxJob(req.user!.userId, req.params.jobId);
  if (!job) return res.status(404).json({ error: "Sandbox job not found" });
  res.json(job);
});

router.get("/sandbox/jobs/:jobId/stream", (req, res) => {
  const job = getSandboxJob(req.user!.userId, req.params.jobId);
  if (!job) return res.status(404).json({ error: "Sandbox job not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  writeEvent(res, { type: "log", line: `[sandbox] Attached to job ${job.id}` });
  for (const line of job.logs.slice(-80)) {
    writeEvent(res, { type: "log", line });
  }
  if (job.result) {
    writeEvent(res, { type: "done", jobId: job.id, result: job.result });
    res.end();
    return;
  }

  const unsubscribe = subscribeSandboxJob(job.id, (event) => {
    writeEvent(res, event);
    if (event.type === "done") {
      unsubscribe();
      res.end();
    }
  });

  req.on("close", unsubscribe);
});

export default router;
