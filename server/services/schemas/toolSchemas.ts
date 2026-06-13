// ─────────────────────────────────────────────────────────────
// server/services/schemas/toolSchemas.ts
// Zod schemas validating arguments for every registered tool
// ─────────────────────────────────────────────────────────────
import { z } from "zod";

export const filesystemSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), path: z.string().min(1) }),
  z.object({ action: z.literal("write"), path: z.string().min(1), content: z.string() }),
  z.object({ action: z.literal("list"), path: z.string().default(".") }),
  z.object({ action: z.literal("mkdir"), path: z.string().min(1), recursive: z.boolean().optional() }),
  z.object({ action: z.literal("delete"), path: z.string().min(1) }),
  z.object({ action: z.literal("move"), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ action: z.literal("stat"), path: z.string().min(1) }),
  z.object({ action: z.literal("create"), path: z.string().min(1), content: z.string().optional() }),
]);

export const terminalSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

export const searchSchema = z.object({
  query: z.string().min(1),
  path: z.string().default("."),
  maxResults: z.number().int().positive().max(200).optional(),
  fileExtensions: z.array(z.string()).optional(),
});

export const grepSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().default("."),
  caseSensitive: z.boolean().optional(),
  maxResults: z.number().int().positive().max(500).optional(),
});

export const databaseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("query"), sql: z.string().min(1), params: z.array(z.any()).optional() }),
  z.object({ action: z.literal("describeTables") }),
]);

export const githubSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clone"), url: z.string().url(), dir: z.string().optional() }),
  z.object({ action: z.literal("commit"), message: z.string().min(1) }),
  z.object({ action: z.literal("push"), branch: z.string().optional(), remote: z.string().optional() }),
  z.object({ action: z.literal("createPR"), title: z.string().min(1), head: z.string(), base: z.string().default("main"), body: z.string().optional() }),
]);

export const browserSchema = z.object({
  url: z.string().url(),
  maxLength: z.number().int().positive().max(50_000).optional(),
});

/** Map of tool name -> zod schema, used by the toolRegistry for validation */
export const toolSchemas = {
  filesystem: filesystemSchema,
  terminal: terminalSchema,
  search: searchSchema,
  grep: grepSchema,
  database: databaseSchema,
  github: githubSchema,
  browser: browserSchema,
} as const;

export type ToolName = keyof typeof toolSchemas;