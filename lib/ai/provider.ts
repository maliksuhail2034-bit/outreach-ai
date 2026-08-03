// Provider-agnostic contract for turning a fixed prompt into natural-language
// text. Exactly one caller exists (lib/ai/recommendations.ts) and it only
// ever depends on this interface, never a concrete provider class — mirrors
// lib/integrations/provider.ts's IntegrationProvider split (interface +
// classified error + factory) exactly.
//
// Deliberately the smallest possible surface (one prompt in, one string
// out): this app never uses tool-calling, streaming, or multi-turn chat for
// recommendations — see lib/ai/prompt.ts for why a single fixed prompt is
// enough to satisfy "the LLM never calculates metrics, it only phrases
// already-computed ones."
export interface AiGenerationResult {
  text: string;
}

// Thrown by any AiProvider implementation on failure. `outcome` mirrors
// EmailSendError/IntegrationDeliveryError's classification:
//   "retry"       — transient (network error, 5xx, timeout); safe to let the
//                   user click "Generate" again.
//   "invalid_key" — the connected API key itself was rejected (401/403);
//                   the settings UI should point the user back to
//                   Settings -> AI rather than suggesting a retry.
//   "failed"      — terminal for this attempt for any other reason (bad
//                   request, unexpected response shape).
// This class only carries the classification — no retry loop lives here;
// generation is always a single manual attempt (see ROADMAP.md: no
// scheduled AI worker in v1).
export class AiGenerationError extends Error {
  constructor(
    message: string,
    public readonly outcome: "retry" | "invalid_key" | "failed",
  ) {
    super(message);
    this.name = "AiGenerationError";
  }
}

export interface AiProvider {
  generate(prompt: string): Promise<AiGenerationResult>;
}
