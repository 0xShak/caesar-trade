import process from "node:process";
import { getDb, closeDb } from "@caesar/db";
import { fetchPolymarketBundles } from "./polymarket.js";
import { fetchKalshiBundles } from "./kalshi.js";
import { upsertBundles, recomputeTagCounts, recordSync, type NormBundle } from "./normalize.js";

/**
 * Ingest runner. `--once` runs a single pass and exits (used for CI / manual
 * refresh); otherwise it polls on an interval. Each venue is isolated: a failure
 * in one ingester is recorded in sync_state and does not abort the other.
 */
const args = new Set(process.argv.slice(2));
const ONCE = args.has("--once");
const POLY_ONLY = args.has("--poly");
const KALSHI_ONLY = args.has("--kalshi");
const INTERVAL_MS = 60_000;
const MAX_EVENTS = Number(process.env.INGEST_MAX_EVENTS ?? 400);

async function runVenue(
  key: string,
  fetcher: (opts: { maxEvents: number }) => Promise<NormBundle[]>,
): Promise<number> {
  const db = getDb();
  try {
    const bundles = await fetcher({ maxEvents: MAX_EVENTS });
    await upsertBundles(db, bundles);
    await recordSync(db, key, "ok", `${bundles.length} markets`);
    console.log(`[${key}] upserted ${bundles.length} markets`);
    return bundles.length;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await recordSync(db, key, "error", msg).catch(() => {});
    console.error(`[${key}] FAILED: ${msg}`);
    return 0;
  }
}

async function pass(): Promise<void> {
  const started = Date.now();
  if (!KALSHI_ONLY) await runVenue("polymarket:markets", fetchPolymarketBundles);
  if (!POLY_ONLY) await runVenue("kalshi:markets", fetchKalshiBundles);
  await recomputeTagCounts(getDb()).catch((e) => console.error("tag recount:", e));
  console.log(`pass complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function main() {
  if (ONCE) {
    await pass();
    await closeDb();
    return;
  }
  console.log(`ingest loop every ${INTERVAL_MS / 1000}s (maxEvents=${MAX_EVENTS})`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await pass();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
