import { decryptSecret, encryptSecret, parseEncryptionKey } from "@/lib/crypto/aes-secret";

function getEncryptionKey() {
  return parseEncryptionKey("VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY", process.env.VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY);
}

// Produces the ciphertext stored in verification_provider_keys.encrypted_api_key
// — see supabase/migrations/*_verification_provider_keys.sql. A separate key
// from MAILBOX_ENCRYPTION_KEY/AI_PROVIDER_KEY_ENCRYPTION_KEY on purpose (same
// reasoning as those): a leaked verification key lets someone spend against
// the organization's own MillionVerifier billing, a different blast radius
// than mailbox or AI provider credentials. Server-only: never call from a
// Client Component or any code path reachable by client bundling.
export function encryptVerificationProviderKey(plaintext: string): string {
  return encryptSecret(plaintext, getEncryptionKey());
}

// Reverses encryptVerificationProviderKey(). Restricted to
// lib/verification/verify.ts's single-lead path and
// lib/verification/bulk-worker.ts's claimed-lead loop — never returned to
// the client, never logged.
export function decryptVerificationProviderKey(ciphertext: string): string {
  return decryptSecret(ciphertext, getEncryptionKey());
}
