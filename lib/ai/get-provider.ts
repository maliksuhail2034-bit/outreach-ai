import type { AiProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { GoogleProvider } from "./providers/google";
import { OpenAiProvider } from "./providers/openai";

export type AiProviderName = "anthropic" | "openai" | "google";

// The one place that maps a provider name + decrypted API key to its
// implementation — every caller (lib/ai/recommendations.ts today) depends
// only on this function and the AiProvider interface, never on a concrete
// provider class directly. Mirrors lib/integrations/get-provider.ts exactly.
//
// This is also the seam a future managed-AI option plugs into: today
// `apiKey` always comes from a decrypted ai_provider_keys row (BYOK, see
// lib/ai/recommendations.ts); a managed mode would call this same function
// with the app's own server-side key instead, with no change here and no
// change to prompt-building, storage, or the UI beyond a settings toggle.
export function getAiProvider(provider: AiProviderName, apiKey: string, model?: string | null): AiProvider {
  switch (provider) {
    case "anthropic":
      return model ? new AnthropicProvider(apiKey, model) : new AnthropicProvider(apiKey);
    case "openai":
      return model ? new OpenAiProvider(apiKey, model) : new OpenAiProvider(apiKey);
    case "google":
      return model ? new GoogleProvider(apiKey, model) : new GoogleProvider(apiKey);
    default:
      throw new Error(`No AI provider registered for '${provider satisfies never}'.`);
  }
}
