/**
 * SPIKE C (CLI helper) — Privy server-side token verification.
 *
 * The real interactive round-trip is driven by the web app:
 *   1) pnpm --filter @caesar/api dev     (api on :4000)
 *   2) pnpm --filter @caesar/web dev     (web on :3000)
 *   3) open http://localhost:3000/spike-privy, log in → it POSTs the tokens to
 *      /api/spike/privy-verify which verifies them server-side.
 *
 * This script is the headless path: pass a Privy access token as argv[2] (e.g.
 * captured from the browser) to verify it from the terminal.
 *
 * Run: pnpm --filter @caesar/api spike:privy -- <accessToken>
 */
import process from "node:process";
import { loadEnv } from "@caesar/config";
import { PrivyClient } from "@privy-io/server-auth";

const env = loadEnv();

if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
  console.log("SPIKE C: DEFERRED — set PRIVY_APP_ID and PRIVY_APP_SECRET in .env first.");
  process.exit(0);
}

const accessToken = process.argv[2] ?? process.env.PRIVY_TEST_ACCESS_TOKEN;
if (!accessToken) {
  console.log(
    [
      "SPIKE C: no token provided.",
      "Drive the interactive round-trip via the web app:",
      "  pnpm --filter @caesar/api dev   # api :4000",
      "  pnpm --filter @caesar/web dev   # web :3000  → open /spike-privy, log in",
      "Or pass a token headless: pnpm --filter @caesar/api spike:privy -- <accessToken>",
    ].join("\n"),
  );
  process.exit(0);
}

const privy = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
try {
  const claims = await privy.verifyAuthToken(accessToken);
  console.log(`SPIKE C: PASS — verified Privy user ${claims.userId}`);
} catch (err) {
  console.error(`SPIKE C: FAIL — ${(err as Error).message}`);
  process.exit(1);
}
