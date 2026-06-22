/**
 * Symmetric encryption for secrets at rest (per-user CLOB API creds).
 *
 * AES-256-GCM with a 32-byte key from `CAESAR_CREDS_ENC_KEY` (hex = 64 chars, or
 * base64). The output is `iv:tag:ciphertext`, each segment base64. GCM gives us
 * authenticated encryption — a tampered blob fails to decrypt rather than
 * yielding garbage. The key NEVER leaves the server; the plaintext is only the
 * derived {key, secret, passphrase} triple, decrypted at order-submit time.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

/** Parse the 32-byte key from env (hex or base64). Throws loudly if unusable. */
function encryptionKey(): Buffer {
  const raw = process.env.CAESAR_CREDS_ENC_KEY;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "CAESAR_CREDS_ENC_KEY is not set — required to store/read CLOB credentials. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  const trimmed = raw.trim();
  // 64 hex chars → 32 bytes; else try base64.
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error(
      `CAESAR_CREDS_ENC_KEY must decode to 32 bytes (got ${key.length}). ` +
        "Use a 64-char hex string (openssl rand -hex 32) or 32-byte base64.",
    );
  }
  return key;
}

/** Encrypt a UTF-8 string → `iv:tag:ciphertext` (each base64). */
export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypt an `iv:tag:ciphertext` blob produced by {@link encryptSecret}. */
export function decryptSecret(blob: string): string {
  const key = encryptionKey();
  const parts = blob.split(":");
  if (parts.length !== 3) {
    throw new Error("malformed encrypted blob (expected iv:tag:ciphertext)");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** True when an encryption key is configured (so resolvers can fail fast/clear). */
export function hasEncryptionKey(): boolean {
  const raw = process.env.CAESAR_CREDS_ENC_KEY;
  return !!raw && raw.trim() !== "";
}
