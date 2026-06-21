import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, closeDb } from "./client.js";

/** Apply pending SQL migrations from ./drizzle, then exit. */
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

async function main() {
  await migrate(getDb(), { migrationsFolder });
  console.log("migrations applied");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
