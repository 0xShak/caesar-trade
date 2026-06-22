/**
 * Per-user CLOB credential persistence (encrypted at rest).
 *
 * Stores the {key, secret, passphrase} triple derived from a user's L1 ClobAuth
 * signature, AES-256-GCM-encrypted (apps/api/src/secrets.ts). The `hasApiCreds`
 * boolean on `users` mirrors presence here so reads stay cheap; the actual
 * secrets are only ever decrypted server-side at order-submit time.
 */
import { getDb, users, polymarketCredentials } from "@caesar/db";
import { eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./secrets.js";
import type { ApiCreds } from "./clob.js";

/** Encrypt + upsert the user's creds, and flip `users.hasApiCredentials`. */
export async function storeCredentials(
  userId: string,
  signerAddress: string,
  creds: ApiCreds,
): Promise<void> {
  const encrypted = encryptSecret(JSON.stringify(creds));
  const db = getDb();
  await db
    .insert(polymarketCredentials)
    .values({ userId, encrypted, signerAddress })
    .onConflictDoUpdate({
      target: polymarketCredentials.userId,
      set: { encrypted, signerAddress, updatedAt: new Date() },
    });
  await db.update(users).set({ hasApiCredentials: true }).where(eq(users.id, userId));
}

export interface StoredCredentials {
  creds: ApiCreds;
  signerAddress: string;
}

/** Load + decrypt the user's creds, or null if none stored. */
export async function loadCredentials(userId: string): Promise<StoredCredentials | null> {
  const rows = await getDb()
    .select({
      encrypted: polymarketCredentials.encrypted,
      signerAddress: polymarketCredentials.signerAddress,
    })
    .from(polymarketCredentials)
    .where(eq(polymarketCredentials.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const creds = JSON.parse(decryptSecret(row.encrypted)) as ApiCreds;
  return { creds, signerAddress: row.signerAddress };
}
