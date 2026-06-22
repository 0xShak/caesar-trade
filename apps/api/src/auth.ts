import { PrivyClient, type User } from "@privy-io/server-auth";
import { loadEnv } from "@caesar/config";

/**
 * Phase 2 server-side Privy auth. The web client sends two headers (bible §6):
 *   Authorization: Bearer <accessToken>   — short-lived, cryptographically verified
 *   privy-id-token: <identityToken>        — signed, carries linked accounts
 *
 * We verify the access token (authenticates the user → DID) and keep the
 * identity token around so resolvers can decode the full user object LOCALLY
 * via `getUser({ idToken })` — no rate-limited API call (Privy's recommended
 * path). The PrivyClient is a lazily-built singleton.
 */

let client: PrivyClient | null | undefined;

/** Lazily build the PrivyClient; null when creds are absent (dev without .env). */
export function getPrivyClient(): PrivyClient | null {
  if (client !== undefined) return client;
  const env = loadEnv();
  client =
    env.PRIVY_APP_ID && env.PRIVY_APP_SECRET
      ? new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET)
      : null;
  return client;
}

export interface AuthContext {
  /** Privy DID of the authenticated user. */
  userId: string;
  /** Raw identity token (if sent) for local getUser({idToken}) decoding. */
  idToken?: string;
}

export interface GraphQLContext {
  auth: AuthContext | null;
}

function bearer(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : undefined;
}

/**
 * Core context builder from raw tokens. Verifies the access token if present;
 * unauthenticated/invalid tokens resolve `auth: null` (read paths still work) —
 * never throws, so public queries are unaffected by a stale/garbage token.
 */
async function buildContextFromTokens(
  accessToken: string | undefined,
  idToken: string | undefined,
): Promise<GraphQLContext> {
  const privy = getPrivyClient();
  if (!privy || !accessToken) return { auth: null };
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    return { auth: { userId: claims.userId, idToken } };
  } catch {
    return { auth: null };
  }
}

/** HTTP path: build context from request headers (Authorization + privy-id-token). */
export function buildContext(headers: Headers): Promise<GraphQLContext> {
  return buildContextFromTokens(
    bearer(headers.get("authorization")),
    headers.get("privy-id-token") ?? undefined,
  );
}

/** WS path: build context from graphql-ws connectionParams (see lib/apollo.ts). */
export function buildWsContext(
  params: Record<string, unknown> | undefined,
): Promise<GraphQLContext> {
  const auth = typeof params?.["authorization"] === "string" ? params["authorization"] : undefined;
  const idToken = typeof params?.["privy-id-token"] === "string" ? params["privy-id-token"] : undefined;
  return buildContextFromTokens(bearer(auth), idToken);
}

/**
 * Resolve the embedded EVM wallet address for the authenticated user. Prefers
 * decoding the identity token locally (no API call); falls back to a fetch by
 * DID. Returns null if Privy is unconfigured or no embedded wallet exists yet
 * (e.g. dashboard `create_on_login` still off).
 */
export async function getEmbeddedWallet(
  auth: AuthContext,
): Promise<{ address: string; user: User } | null> {
  const privy = getPrivyClient();
  if (!privy) return null;

  let user: User;
  try {
    user = auth.idToken
      ? await privy.getUser({ idToken: auth.idToken })
      : await privy.getUserById(auth.userId);
  } catch {
    return null;
  }

  const wallet = user.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      "walletClientType" in a &&
      a.walletClientType === "privy" &&
      "chainType" in a &&
      a.chainType === "ethereum",
  );
  const address =
    wallet && "address" in wallet && typeof wallet.address === "string"
      ? wallet.address
      : null;
  return address ? { address, user } : null;
}
