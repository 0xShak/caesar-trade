/**
 * Phase 2 identity resolvers — `me` query + `syncTosFromPrivy` mutation.
 *
 * `me` reads the authenticated user from the `users` table (Privy DID = PK),
 * creating the row on first login and backfilling the embedded-wallet address +
 * email from Privy. Unauthenticated requests resolve null (the FE treats that as
 * "logged out"). `isWalletSetupComplete` is DERIVED here, never stored.
 */
import { getDb, users, type UserRow } from "@caesar/db";
import { eq } from "drizzle-orm";
import type { User } from "@privy-io/server-auth";
import { isAddress, type Address } from "viem";
import { deriveTradingWallet } from "@caesar/chain";
import { getEmbeddedWallet, type GraphQLContext } from "../auth.js";

/** Current Terms-of-Service version users accept (bible §13 onboarding gate). */
export const TOS_VERSION = "1.0";

/** Shape returned to the `Me` SDL type. */
function toMe(row: UserRow) {
  return {
    id: row.id,
    tosAccepted: row.tosAccepted,
    tosVersion: row.tosVersion,
    inviteClaimed: row.inviteClaimed,
    referralCode: row.referralCode,
    referralsRemaining: null,
    referralsTotal: null,
    parityAdmin: row.parityAdmin,
    polymarketTradingAddress: row.polymarketTradingAddress,
    polymarketWalletKind: row.polymarketWalletKind,
    polymarketTradingAccounts: [],
    defaultPolymarketTradingAccountId: null,
    defaultKalshiTradingAccountId: null,
    welcomeWizardCompleted: row.welcomeWizardCompleted,
    hasServerSigner: row.hasServerSigner,
    isSafeDeployed: row.isSafeDeployed,
    hasV1Approvals: row.hasV1Approvals,
    hasV2Approvals: row.hasV2Approvals,
    hasApiCredentials: row.hasApiCredentials,
    // Derived: a wallet is "set up" once the signer + Safe + approvals + creds
    // are all in place. (CLOB api creds are gated behind mainnet — §15.)
    isWalletSetupComplete:
      row.hasServerSigner &&
      row.isSafeDeployed &&
      row.hasV1Approvals &&
      row.hasV2Approvals &&
      row.hasApiCredentials,
    socialTwitter: row.socialTwitter,
    profilePictureUrl: row.profilePictureUrl,
    polymarketTrader: null,
  };
}

function emailOf(user: User | null): string | null {
  if (!user) return null;
  const acct = user.linkedAccounts.find((a) => a.type === "email");
  return acct && "address" in acct && typeof acct.address === "string"
    ? acct.address
    : null;
}

/**
 * Load (or lazily create) the user row for the authenticated DID, backfilling
 * the embedded wallet + email from Privy. Returns null when unauthenticated.
 */
async function loadOrCreateUser(ctx: GraphQLContext): Promise<UserRow | null> {
  if (!ctx.auth) return null;
  const db = getDb();
  const id = ctx.auth.userId;

  const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
  let row = existing[0];

  // Backfill embedded wallet / email from Privy (cheap: identity-token decode).
  const wallet = await getEmbeddedWallet(ctx.auth);
  const embeddedWalletAddress = wallet?.address ?? null;
  const email = emailOf(wallet?.user ?? null);

  // The Polymarket funder (Gnosis Safe) is DETERMINISTICALLY derived from the
  // signer EOA — a predicted address (not yet deployed; verify before mainnet).
  const derived =
    embeddedWalletAddress && isAddress(embeddedWalletAddress)
      ? deriveTradingWallet(embeddedWalletAddress as Address, "safe")
      : null;
  const polymarketTradingAddress = derived?.address ?? null;
  const polymarketWalletKind = derived ? "safe" : null;

  if (!row) {
    const inserted = await db
      .insert(users)
      .values({
        id,
        embeddedWalletAddress,
        email,
        polymarketTradingAddress,
        polymarketWalletKind,
      })
      .onConflictDoNothing()
      .returning();
    row =
      inserted[0] ??
      (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  } else if (
    (embeddedWalletAddress && embeddedWalletAddress !== row.embeddedWalletAddress) ||
    (email && email !== row.email) ||
    (polymarketTradingAddress && polymarketTradingAddress !== row.polymarketTradingAddress)
  ) {
    const updated = await db
      .update(users)
      .set({
        embeddedWalletAddress: embeddedWalletAddress ?? row.embeddedWalletAddress,
        email: email ?? row.email,
        polymarketTradingAddress: polymarketTradingAddress ?? row.polymarketTradingAddress,
        polymarketWalletKind: polymarketWalletKind ?? row.polymarketWalletKind,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    row = updated[0] ?? row;
  }

  return row ?? null;
}

export async function resolveMe(ctx: GraphQLContext) {
  const row = await loadOrCreateUser(ctx);
  return row ? toMe(row) : null;
}

/**
 * `syncTosFromPrivy(acceptTos)` — record ToS acceptance (and stamp the version).
 * Mirrors Parity's mutation name. Requires auth; returns the updated `Me`.
 */
export async function resolveSyncTosFromPrivy(
  ctx: GraphQLContext,
  acceptTos: boolean | null | undefined,
) {
  const row = await loadOrCreateUser(ctx);
  if (!row) return null;
  if (acceptTos === false) return toMe(row);

  const db = getDb();
  const updated = await db
    .update(users)
    .set({ tosAccepted: true, tosVersion: TOS_VERSION, updatedAt: new Date() })
    .where(eq(users.id, row.id))
    .returning();
  return toMe(updated[0] ?? row);
}
