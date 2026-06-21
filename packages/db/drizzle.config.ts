import process from "node:process";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit reads DATABASE_URL straight from the environment (populated by
 * `node --env-file` or the shell). Migrations are emitted to ./drizzle and
 * applied via `pnpm db:migrate` (programmatic) or `pnpm db:push` (dev).
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://caesar:caesar@localhost:55432/caesar",
  },
  strict: true,
  verbose: true,
});
