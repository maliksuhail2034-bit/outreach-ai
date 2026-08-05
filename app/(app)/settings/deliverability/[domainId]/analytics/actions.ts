"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization } from "@/lib/db";
import { generateRecommendation } from "@/lib/ai/recommendations";
import type { AiProviderName } from "@/lib/ai/get-provider";
import { generateRecommendationSchema } from "@/lib/validations/ai";
import { checkRateLimit } from "@/lib/rate-limit/check-rate-limit";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client component only
// ever calls this bound to a domainId it already rendered (see
// components/ai/recommendation-card.tsx). Ownership is re-checked inside
// generateRecommendation -> buildRecommendationSnapshot's
// loadDomainAnalyticsSnapshot call, which throws if this domain isn't the
// caller's.
export async function generateDomainRecommendationAction(domainId: string, provider: AiProviderName) {
  const parsed = generateRecommendationSchema.parse({ entityType: "domain", entityId: domainId, provider });
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);
  await checkRateLimit("ai:generate", organization.id);

  const recommendation = await generateRecommendation(supabase, user.id, organization.id, user.id, {
    entityType: "domain",
    entityId: parsed.entityId ?? null,
    provider: parsed.provider,
  });

  revalidatePath(`/settings/deliverability/${domainId}/analytics`);
  return recommendation;
}
