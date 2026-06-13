// server/db/schema.ts
import { pgTable, text, integer, bigint, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id:           text("id").primaryKey(),
  email:        text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  plan:         text("plan").notNull().default("free"),
  usageCount:   integer("usage_count").notNull().default(0),
  usageLimit:   integer("usage_limit").notNull().default(100),
  createdAt:    bigint("created_at", { mode: "number" }).notNull(),
  lastLogin:    bigint("last_login", { mode: "number" }),
}, (t) => [
  index("users_email_idx").on(t.email),
]);

export const sessions = pgTable("sessions", {
  id:          text("id").primaryKey(),
  userId:      text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title:       text("title").notNull().default("New Chat"),
  messages:    text("messages").notNull().default("[]"),
  createdAt:   bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:   bigint("updated_at", { mode: "number" }).notNull(),
  workspaceId: text("workspace_id"),
}, (t) => [
  index("sessions_user_idx").on(t.userId),
]);

export const agentSessions = pgTable("agent_sessions", {
  sessionId: text("session_id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  prompt:    text("prompt").notNull().default(""),
  plan:      text("plan"),
  files:     text("files").notNull().default("[]"),
  logs:      text("logs").notNull().default("[]"),
  state:     text("state").notNull().default("idle"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  index("agent_sessions_user_idx").on(t.userId),
]);

export const workspaces = pgTable("workspaces", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name:      text("name").notNull(),
  tree:      text("tree").notNull().default("[]"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (t) => [
  index("workspaces_user_idx").on(t.userId),
]);

export const deployments = pgTable("deployments", {
  id:            text("id").primaryKey(),
  userId:        text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectName:   text("project_name").notNull(),
  provider:      text("provider").notNull(),
  deploymentUrl: text("deployment_url").notNull().default(""),
  status:        text("status").notNull().default("idle"),
  createdAt:     bigint("created_at", { mode: "number" }).notNull(),
}, (t) => [
  index("deployments_user_idx").on(t.userId),
]);

export const sandboxJobs = pgTable("sandbox_jobs", {
  id:            text("id").primaryKey(),
  userId:        text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status:        text("status").notNull().default("queued"),
  commands:      text("commands").notNull().default("[]"),
  result:        text("result"),
  logs:          text("logs").notNull().default("[]"),
  workspacePath: text("workspace_path").notNull().default(""),
  mode:          text("mode").notNull().default("local"),
  policy:        text("policy").notNull().default("{}"),
  resourceUsage: text("resource_usage").notNull().default("{}"),
  failureSummary:text("failure_summary").notNull().default(""),
  createdAt:     bigint("created_at", { mode: "number" }).notNull(),
  startedAt:     bigint("started_at", { mode: "number" }),
  updatedAt:     bigint("updated_at", { mode: "number" }).notNull(),
  completedAt:   bigint("completed_at", { mode: "number" }),
}, (t) => [
  index("sandbox_jobs_user_idx").on(t.userId),
  index("sandbox_jobs_status_idx").on(t.status),
]);

export const githubConnections = pgTable("github_connections", {
  userId:         text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  username:       text("username").notNull(),
  encryptedToken: text("encrypted_token").notNull(),
  createdAt:      bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:      bigint("updated_at", { mode: "number" }).notNull(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (t) => [
  index("refresh_tokens_user_idx").on(t.userId),
  index("refresh_tokens_hash_idx").on(t.tokenHash),
]);