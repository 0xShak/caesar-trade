import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { loadEnv } from "@caesar/config";
import * as schema from "./schema.js";

/**
 * Lazily-constructed singleton Drizzle client over a node-postgres Pool.
 * `DATABASE_URL` comes from validated env (@caesar/config). Callers import
 * `getDb()` — the pool is created on first use so importing the schema (e.g.
 * for drizzle-kit) never opens a connection.
 */
let pool: pg.Pool | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
  }
  return pool;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

export type Db = ReturnType<typeof getDb>;

/** Close the pool (tests / graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    dbInstance = undefined;
  }
}
