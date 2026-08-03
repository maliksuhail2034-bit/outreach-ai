import { decryptSecret, encryptSecret, parseEncryptionKey } from "@/lib/crypto/aes-secret";

function getEncryptionKey() {
  return parseEncryptionKey("AI_PROVIDER_KEY_ENCRYPTION_KEY", process.env.AI_PROVIDER_KEY_ENCRYPTION_KEY);
}

// Produces the ciphertext stored in ai_provider_keys.encrypted_api_key — see
// supabase/migrations/*_ai_provider_keys.sql. A separate key from
// MAILBOX_ENCRYPTION_KEY on purpose (same reasoning as
// UNSUBSCRIBE_TOKEN_SECRET): a leaked AI provider key lets someone spend
// against the organization's own Anthropic/OpenAI/Gemini billing, a
// different blast radius than mailbox credentials. Server-only: never call
// from a Client Component or any code path reachable by client bundling.
export function encryptAiProviderKey(plaintext: string): string {
  return encryptSecret(plaintext, getEncryptionKey());
}

// Reverses encryptAiProviderKey(). Restricted to lib/ai/recommendations.ts's
// generation path — never returned to the client, never logged.
export function decryptAiProviderKey(ciphertext: string): string {
  return decryptSecret(ciphertext, getEncryptionKey());
}
