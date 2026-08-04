import type { VerificationProvider } from "./provider";
import { MillionVerifierProvider } from "./providers/millionverifier";

export type VerificationProviderName = "millionverifier";

// The one place that maps a provider name + decrypted API key to its
// implementation — every caller (lib/verification/verify.ts,
// lib/verification/bulk-worker.ts) depends only on this function and the
// VerificationProvider interface, never on a concrete provider class
// directly. Mirrors lib/ai/get-provider.ts exactly.
//
// This is also the seam a future managed-credit option plugs into: today
// `apiKey` always comes from a decrypted verification_provider_keys row
// (BYOK, see lib/verification/verify.ts) — outreach-ai never purchases
// verification credit on a user's behalf in v1. A managed mode would call
// this same function with the app's own server-side key instead, with no
// change here and no change to how a result is stored or rendered.
export function getVerificationProvider(provider: VerificationProviderName, apiKey: string): VerificationProvider {
  switch (provider) {
    case "millionverifier":
      return new MillionVerifierProvider(apiKey);
    default:
      throw new Error(`No verification provider registered for '${provider satisfies never}'.`);
  }
}
