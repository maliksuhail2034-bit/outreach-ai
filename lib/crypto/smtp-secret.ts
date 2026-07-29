import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function getEncryptionKey(): Buffer {
  const key = process.env.MAILBOX_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "MAILBOX_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to .env.local — see .env.example.",
    );
  }
  const keyBuffer = Buffer.from(key, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error("MAILBOX_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256-GCM.");
  }
  return keyBuffer;
}

// Produces the ciphertext stored in mailboxes.encrypted_smtp_password — see
// supabase/migrations/20260728100030_mailboxes.sql. Server-only: never call
// from a Client Component or any code path reachable by client bundling.
export function encryptSmtpPassword(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((part) => part.toString("base64")).join(":");
}

// Reverses encryptSmtpPassword(). Restricted to the trusted sending-worker
// path — pair only with getMailboxCredentials() in lib/db/mailboxes.ts,
// never with a code path reachable by the browser.
export function decryptSmtpPassword(ciphertext: string): string {
  const [ivPart, authTagPart, dataPart] = ciphertext.split(":");
  if (!ivPart || !authTagPart || !dataPart) {
    throw new Error("Malformed SMTP ciphertext.");
  }
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
