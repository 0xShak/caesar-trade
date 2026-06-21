/**
 * SPIKE B — Kalshi RSA-PSS request signing de-risk.
 *
 * Built now; the live call is gated on demo creds. Offline crypto round-trip is
 * the always-on PASS bar.
 *
 * Run: pnpm --filter @caesar/api spike:kalshi
 *
 * ── CONFIRMED scheme (Kalshi official docs, 2026-06-21) ──────────────────────
 *  Source: https://docs.kalshi.com/getting_started/api_keys
 *  - Signed message  : `${timestampMs}${METHOD}${path}`  (concat, no separators)
 *  - METHOD          : uppercase HTTP verb (GET/POST/…)
 *  - path            : includes the `/trade-api/v2` prefix, EXCLUDES query string
 *  - timestamp       : Unix time in MILLISECONDS (not seconds)
 *  - signature algo  : RSA-PSS, hash = SHA-256, MGF1-SHA256,
 *                      saltLength = RSA_PSS_SALTLEN_DIGEST (= digest length, 32B)
 *                      → node padding RSA_PKCS1_PSS_PADDING
 *  - output          : base64
 *  - headers         : KALSHI-ACCESS-KEY (key id), KALSHI-ACCESS-SIGNATURE (b64),
 *                      KALSHI-ACCESS-TIMESTAMP (the same ms value that was signed)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { constants, createSign, generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnv } from "@caesar/config";

const PSS_PADDING = {
  padding: constants.RSA_PKCS1_PSS_PADDING,
  saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
} as const;

/** Build the exact message Kalshi signs. */
export function kalshiSigningMessage(method: string, path: string, timestampMs: number): string {
  return `${timestampMs}${method.toUpperCase()}${path}`;
}

/**
 * Sign a Kalshi request. Returns base64 RSA-PSS/SHA-256 signature.
 * `privateKeyPem` is a PEM-encoded RSA private key string.
 */
export function signKalshiRequest(
  privateKeyPem: string,
  method: string,
  path: string,
  timestampMs: number,
): string {
  const msg = kalshiSigningMessage(method, path, timestampMs);
  const signer = createSign("SHA256");
  signer.update(msg);
  signer.end();
  return signer.sign({ key: privateKeyPem, ...PSS_PADDING }, "base64");
}

export function kalshiHeaders(
  keyId: string,
  privateKeyPem: string,
  method: string,
  path: string,
  timestampMs: number = Date.now(),
): Record<string, string> {
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-SIGNATURE": signKalshiRequest(privateKeyPem, method, path, timestampMs),
    "KALSHI-ACCESS-TIMESTAMP": String(timestampMs),
  };
}

function offlineSelfTest(): boolean {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const ts = Date.now();
  const method = "GET";
  const path = "/trade-api/v2/portfolio/balance";
  const msg = kalshiSigningMessage(method, path, ts);

  const sig = signKalshiRequest(privPem, method, path, ts);
  const ok = verify("SHA256", Buffer.from(msg), { key: publicKey, ...PSS_PADDING }, Buffer.from(sig, "base64"));
  console.log(`[offline] signed msg="${msg.slice(0, 40)}…" sig.len=${sig.length}`);
  console.log(`[offline] RSA-PSS round-trip verify: ${ok ? "PASS" : "FAIL"}`);
  return ok;
}

async function gatedLiveTest(): Promise<"PASS" | "FAIL" | "DEFERRED"> {
  const env = loadEnv();
  if (!env.KALSHI_API_KEY_ID || !env.KALSHI_PRIVATE_KEY_PEM) {
    return "DEFERRED";
  }
  let pem: string;
  try {
    // KALSHI_PRIVATE_KEY_PEM may be a file path OR an inline PEM.
    pem = env.KALSHI_PRIVATE_KEY_PEM.includes("BEGIN")
      ? env.KALSHI_PRIVATE_KEY_PEM
      : readFileSync(env.KALSHI_PRIVATE_KEY_PEM, "utf8");
  } catch (err) {
    console.log(`[live] could not read PEM: ${err instanceof Error ? err.message : String(err)}`);
    return "FAIL";
  }

  const path = "/trade-api/v2/portfolio/balance";
  const headers = kalshiHeaders(env.KALSHI_API_KEY_ID, pem, "GET", path);
  try {
    const res = await fetch(`${env.KALSHI_API_BASE}${path}`, { method: "GET", headers });
    const text = await res.text();
    const ok = res.status === 200 && text.includes("balance");
    console.log(`[live] GET ${path} → HTTP ${res.status}: ${text.slice(0, 160)}`);
    return ok ? "PASS" : "FAIL";
  } catch (err) {
    console.log(`[live] request errored: ${err instanceof Error ? err.message : String(err)}`);
    return "FAIL";
  }
}

async function main(): Promise<void> {
  const offlineOk = offlineSelfTest();
  const live = await gatedLiveTest();

  console.log("");
  if (live === "DEFERRED") {
    console.log("SPIKE B: DEFERRED — provide demo-api.kalshi.co API key id + RSA private key PEM");
    console.log(`SPIKE B: ${offlineOk ? "PASS (offline)" : "FAIL (offline)"} / DEFERRED (live)`);
  } else {
    console.log(`SPIKE B: ${offlineOk ? "PASS (offline)" : "FAIL (offline)"} / ${live} (live)`);
  }
  if (!offlineOk || live === "FAIL") process.exitCode = 1;
}

main().catch((err) => {
  console.error("SPIKE B: FAIL (unexpected error)");
  console.error(err);
  process.exitCode = 1;
});
