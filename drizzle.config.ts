// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config();

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});