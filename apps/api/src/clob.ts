/**
 * Authenticated Polymarket CLOB REST client — browser-signed model.
 *
 * Unlike `@caesar/chain`'s `createClobClient` (which needs an ethers Signer /
 * private key), this client holds NO key. The L1 ClobAuth signature is produced
 * in the user's browser and passed in; L2 per-request auth is an HMAC over the
 * stored api secret (`buildL2HmacSignature`, pure node:crypto). This is the
 * multi-tenant, server-holds-no-key path (docs/PHASE3-LIVE-TRADING.md).
 *
 * Header + endpoint mechanics verified against @polymarket/clob-client@4.22.8
 * (headers/index.js, endpoints.js, client.js).
 */
import { buildL2HmacSignature } from "@caesar/chain/polymarket";

export interface ApiCreds {
  key: string;
  secret: string;
  passphrase: string;
}

/** L1 headers for the api-key create/derive calls (EIP-712 sig from browser). */
export interface L1Auth {
  signerAddress: string;
  /** ClobAuth EIP-712 signature (hex) produced in-browser. */
  signature: string;
  /** Unix seconds — MUST equal the `timestamp` field the browser signed. */
  timestamp: string;
  /** Nonce — MUST equal the signed `nonce` (default "0"). */
  nonce: string;
}

const DEFAULT_HOST = "https://clob.polymarket.com";

function clobHost(): string {
  const h = process.env.POLYMARKET_CLOB_URL || DEFAULT_HOST;
  return h.endsWith("/") ? h.slice(0, -1) : h;
}

/** Shape the API returns from /auth/api-key and /auth/derive-api-key. */
interface RawApiKeyResponse {
  apiKey?: string;
  secret?: string;
  passphrase?: string;
  error?: string;
}

async function l1Call(method: "POST" | "GET", path: string, auth: L1Auth): Promise<RawApiKeyResponse> {
  const res = await fetch(`${clobHost()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      POLY_ADDRESS: auth.signerAddress,
      POLY_SIGNATURE: auth.signature,
      POLY_TIMESTAMP: auth.timestamp,
      POLY_NONCE: auth.nonce,
    },
  });
  const text = await res.text();
  let json: RawApiKeyResponse;
  try {
    json = text ? (JSON.parse(text) as RawApiKeyResponse) : {};
  } catch {
    throw new Error(`CLOB ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok && !json.apiKey) {
    throw new Error(`CLOB ${path} failed (HTTP ${res.status}): ${json.error ?? text.slice(0, 200)}`);
  }
  return json;
}

/**
 * Derive (or create) the user's CLOB API creds from their L1 ClobAuth signature.
 * Mirrors clob-client `createOrDeriveApiKey`: try create (POST /auth/api-key);
 * if no key comes back, derive the existing one (GET /auth/derive-api-key). Both
 * accept the SAME L1 signature, so the browser signs exactly once.
 */
export async function deriveApiCredentials(auth: L1Auth): Promise<ApiCreds> {
  let raw = await l1Call("POST", "/auth/api-key", auth).catch(() => ({}) as RawApiKeyResponse);
  if (!raw.apiKey) {
    raw = await l1Call("GET", "/auth/derive-api-key", auth);
  }
  if (!raw.apiKey || !raw.secret || !raw.passphrase) {
    throw new Error("CLOB did not return a complete api-key triple (key/secret/passphrase)");
  }
  return { key: raw.apiKey, secret: raw.secret, passphrase: raw.passphrase };
}

/** Build L2 (HMAC) auth headers for a signed request. */
function l2Headers(
  signerAddress: string,
  creds: ApiCreds,
  method: string,
  path: string,
  body: string | undefined,
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = buildL2HmacSignature(creds.secret, ts, method, path, body);
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    POLY_ADDRESS: signerAddress,
    POLY_SIGNATURE: sig,
    POLY_TIMESTAMP: ts,
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

/**
 * A fully-authenticated CLOB request the BROWSER will execute itself (fetch),
 * so the trading POST originates from the user's IP — Polymarket geoblocks the
 * SERVER's datacenter IP, and compliance is per-user (see
 * docs/PHASE3-LIVE-TRADING.md / memory clob-geoblock-architecture). The server
 * still does all the sensitive work (validate sig, inject api key, HMAC); only
 * the network egress moves to the client. The CLOB allows this cross-origin
 * (Access-Control-Allow-Origin: *).
 */
export interface PreparedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Serialize the `@caesar/chain` order envelope to the exact JSON the CLOB wants.
 * The one presentation difference: the wire `side` is the STRING "BUY"/"SELL"
 * (Polymarket's order-JSON convention; the numeric 0/1 is only for the signed
 * EIP-712 struct). Everything else passes through verbatim. The HMAC MUST be
 * computed over this exact string.
 */
function orderEnvelopeToWireJson(envelope: unknown): string {
  const env = envelope as { order?: { side?: unknown } } & Record<string, unknown>;
  const order = (env.order ?? {}) as Record<string, unknown>;
  const wire = {
    ...env,
    order: { ...order, side: order.side === 1 ? "SELL" : "BUY" },
  };
  return JSON.stringify(wire);
}

/** Prepare (but do NOT send) the L2-authenticated POST /order request. */
export function prepareOrderRequest(
  signerAddress: string,
  creds: ApiCreds,
  envelope: unknown,
): PreparedRequest {
  const path = "/order";
  const body = orderEnvelopeToWireJson(envelope);
  return {
    url: `${clobHost()}${path}`,
    method: "POST",
    headers: l2Headers(signerAddress, creds, "POST", path, body),
    body,
  };
}

/** Prepare (but do NOT send) the L2-authenticated DELETE /order cancel request. */
export function prepareCancelRequest(
  signerAddress: string,
  creds: ApiCreds,
  orderId: string,
): PreparedRequest {
  const path = "/order";
  const body = JSON.stringify({ orderID: orderId });
  return {
    url: `${clobHost()}${path}`,
    method: "DELETE",
    headers: l2Headers(signerAddress, creds, "DELETE", path, body),
    body,
  };
}

export interface ClobResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * POST a signed order envelope to /order. `envelope` is the V2 envelope from
 * `@caesar/chain` `buildV2OrderEnvelope` (owner = api key). The HMAC is computed
 * over the EXACT JSON string we send.
 */
export async function postOrder(
  signerAddress: string,
  creds: ApiCreds,
  envelope: unknown,
): Promise<ClobResponse> {
  const path = "/order";
  const body = orderEnvelopeToWireJson(envelope);
  const res = await fetch(`${clobHost()}${path}`, {
    method: "POST",
    headers: l2Headers(signerAddress, creds, "POST", path, body),
    body,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

/** DELETE /order to cancel a single resting order by its CLOB order id (hash). */
export async function cancelOrder(
  signerAddress: string,
  creds: ApiCreds,
  orderId: string,
): Promise<ClobResponse> {
  const path = "/order";
  const body = JSON.stringify({ orderID: orderId });
  const res = await fetch(`${clobHost()}${path}`, {
    method: "DELETE",
    headers: l2Headers(signerAddress, creds, "DELETE", path, body),
    body,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { ok: res.ok, status: res.status, body: parsed };
}
