// scripts/migrate.mjs
import { config } from "dotenv";
config();

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL, // tukar dari DATABASE_URL
});

const db = drizzle(pool);

console.log("Running migrations...");
await migrate(db, { migrationsFolder: "./drizzle/migrations" });
console.log("Migrations done!");
await pool.end();