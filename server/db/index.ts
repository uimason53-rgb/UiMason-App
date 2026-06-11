// ─────────────────────────────────────────────────────────────
// server/db/index.ts
// Database setup — all tables + shared connection
// ─────────────────────────────────────────────────────────────
import Database from "better-sqlite3";

const db = new Database("uimason.db");

// Enable WAL mode for better concurrent performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Create all tables ────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    usageCount INTEGER NOT NULL DEFAULT 0,
    usageLimit INTEGER NOT NULL DEFAULT 100,
    createdAt INTEGER NOT NULL,
    lastLogin INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    messages TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    workspaceId TEXT,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    plan TEXT,
    files TEXT NOT NULL DEFAULT '[]',
    logs TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL DEFAULT 'idle',
    createdAt INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') * 1000 as integer)),
    updatedAt INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') * 1000 as integer)),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    tree TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') * 1000 as integer)),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    projectName TEXT NOT NULL,
    provider TEXT NOT NULL,
    deploymentUrl TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'idle',
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sandbox_jobs (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    commands TEXT NOT NULL DEFAULT '[]',
    result TEXT,
    logs TEXT NOT NULL DEFAULT '[]',
    workspacePath TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    completedAt INTEGER,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS github_connections (
    userId TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    encryptedToken TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export default db;
