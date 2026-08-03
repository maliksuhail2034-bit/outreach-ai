import { decryptSecret, encryptSecret, parseEncryptionKey } from "@/lib/crypto/aes-secret";

function getEncryptionKey() {
  return parseEncryptionKey("MAILBOX_ENCRYPTION_KEY", process.env.MAILBOX_ENCRYPTION_KEY);
}

// Produces the ciphertext stored in mailboxes.encrypted_smtp_password — see
// supabase/migrations/20260728100030_mailboxes.sql. Server-only: never call
// from a Client Component or any code path reachable by client bundling.
export function encryptSmtpPassword(plaintext: string): string {
  return encryptSecret(plaintext, getEncryptionKey());
}

// Reverses encryptSmtpPassword(). Restricted to the trusted sending-worker
// path — pair only with getMailboxCredentials() in lib/db/mailboxes.ts,
// never with a code path reachable by the browser.
export function decryptSmtpPassword(ciphertext: string): string {
  return decryptSecret(ciphertext, getEncryptionKey());
}
