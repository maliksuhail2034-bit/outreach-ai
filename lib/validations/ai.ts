import { z } from "zod";

export const aiProviderSchema = z.enum(["anthropic", "openai", "google"]);

// A pasted key only needs a sanity-check length, not a provider-specific
// format check — each provider's own key prefix conventions
// (sk-ant-/sk-/AIza...) aren't stable enough across account types to
// validate against; the real validation is the first live call succeeding
// (see lib/ai/providers/*.ts's invalid_key classification).
export const connectAiProviderKeySchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().trim().min(20, { message: "Enter a valid API key." }).max(512),
  model: z.string().trim().max(200).optional(),
});
export type ConnectAiProviderKeyInput = z.infer<typeof connectAiProviderKeySchema>;

export const recommendationEntityTypeSchema = z.enum(["campaign", "mailbox", "domain", "organization"]);

export const generateRecommendationSchema = z
  .object({
    entityType: recommendationEntityTypeSchema,
    entityId: z.string().uuid().optional(),
    provider: aiProviderSchema,
  })
  .refine((value) => value.entityType === "organization" || !!value.entityId, {
    message: "entityId is required unless entityType is 'organization'.",
    path: ["entityId"],
  });
export type GenerateRecommendationInput = z.infer<typeof generateRecommendationSchema>;
