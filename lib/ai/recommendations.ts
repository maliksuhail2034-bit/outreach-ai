import type { Json, Tables } from "@/types/database.types";
import type { Client } from "@/lib/db";
import { getAiProviderKeyByProvider, insertAiRecommendation } from "@/lib/db";
import { decryptAiProviderKey } from "@/lib/crypto/ai-provider-key-secret";
import { getAiProvider, type AiProviderName } from "./get-provider";
import { AiGenerationError } from "./provider";
import { buildRecommendationPrompt } from "./prompt";
import { buildRecommendationSnapshot, type RecommendationEntityType } from "./snapshot";

// AI Recommendations v1 is BYOK-only (see ROADMAP.md): every call here uses
// an organization's own connected key, decrypted only for the duration of
// this one request. There is no managed/app-provided key path in v1 — a
// future managed mode would add a second branch here (skip the
// ai_provider_keys lookup, use the app's own key) without touching
// buildRecommendationSnapshot, buildRecommendationPrompt, or the storage
// shape below.

// Generous enough for a 2-4 paragraph recommendation, small enough that a
// misbehaving provider response can't bloat input_snapshot's row
// indefinitely — recommendation_text is rendered as plain text, never HTML,
// but AI output is still treated as untrusted input per CLAUDE.md and
// capped/trimmed before it's persisted or shown.
const MAX_RECOMMENDATION_LENGTH = 4000;

export interface GenerateRecommendationInput {
  entityType: RecommendationEntityType;
  entityId: string | null;
  provider: AiProviderName;
}

// Orchestrates one manual "Generate Recommendation" click end to end:
// load the organization's connected key for the requested provider, decrypt
// it, assemble the deterministic snapshot (reusing existing analytics
// engines — see snapshot.ts), call the provider, and persist the outcome
// (success or failure) as one audit row. Never called on a schedule —
// callers are Server Functions triggered directly by a user click.
export async function generateRecommendation(
  supabase: Client,
  userId: string,
  organizationId: string,
  generatedBy: string,
  input: GenerateRecommendationInput,
): Promise<Tables<"ai_recommendations">> {
  const keyRow = await getAiProviderKeyByProvider(supabase, organizationId, input.provider);
  if (!keyRow) {
    throw new Error(`No ${input.provider} API key is connected. Connect one in Settings -> AI first.`);
  }

  const snapshot = await buildRecommendationSnapshot(supabase, userId, organizationId, input.entityType, input.entityId);
  const prompt = buildRecommendationPrompt(snapshot);
  const model = keyRow.model ?? "";

  try {
    const apiKey = decryptAiProviderKey(keyRow.encrypted_api_key);
    const provider = getAiProvider(input.provider, apiKey, keyRow.model);
    const result = await provider.generate(prompt);
    const text = result.text.trim().slice(0, MAX_RECOMMENDATION_LENGTH);

    return insertAiRecommendation(supabase, {
      organization_id: organizationId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      provider: input.provider,
      model: model || "(provider default)",
      input_snapshot: snapshot as unknown as Json,
      recommendation_text: text,
      status: "success",
      error_message: null,
      generated_by: generatedBy,
    });
  } catch (error) {
    const message =
      error instanceof AiGenerationError || error instanceof Error ? error.message : "Unknown generation error.";

    return insertAiRecommendation(supabase, {
      organization_id: organizationId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      provider: input.provider,
      model: model || "(provider default)",
      input_snapshot: snapshot as unknown as Json,
      recommendation_text: null,
      status: "failed",
      error_message: message,
      generated_by: generatedBy,
    });
  }
}
