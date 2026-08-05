"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/db";
import { generateRecommendation } from "@/lib/ai/recommendations";
import type { AiProviderName } from "@/lib/ai/get-provider";
import { generateRecommendationSchema } from "@/lib/validations/ai";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client component only
// ever calls this bound to a campaignId it already rendered (see
// components/ai/recommendation-card.tsx). Ownership is re-checked inside
// generateRecommendation -> buildRecommendationSnapshot's getCampaign call,
// which throws if this campaign isn't the caller's.
export async function generateCampaignRecommendationAction(campaignId: string, provider: AiProviderName) {
  const parsed = generateRecommendationSchema.parse({ entityType: "campaign", entityId: campaignId, provider });
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const recommendation = await generateRecommendation(supabase, user.id, organization.id, user.id, {
    entityType: "campaign",
    entityId: parsed.entityId ?? null,
    provider: parsed.provider,
  });

  revalidatePath(`/campaigns/${campaignId}/analytics`);
  return recommendation;
}
