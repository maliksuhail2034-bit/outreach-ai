import { z } from "zod";

export const verificationProviderSchema = z.enum(["millionverifier"]);

// A pasted key only needs a sanity-check length, not a provider-specific
// format check — same reasoning as connectAiProviderKeySchema: the real
// validation is the first live call succeeding (see
// lib/verification/providers/millionverifier.ts's invalid_key
// classification).
export const connectVerificationProviderKeySchema = z.object({
  provider: verificationProviderSchema,
  apiKey: z.string().trim().min(10, { message: "Enter a valid API key." }).max(512),
});
export type ConnectVerificationProviderKeyInput = z.infer<typeof connectVerificationProviderKeySchema>;
