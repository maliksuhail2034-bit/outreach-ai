"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateOrganizationForUser } from "@/lib/db";
import { generateRecommendation } from "@/lib/ai/recommendations";
import type { AiProviderName } from "@/lib/ai/get-provider";
import { generateRecommendationSchema } from "@/lib/validations/ai";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client component only
// ever calls this for the caller's own organization (see
// components/ai/recommendation-card.tsx). No entityId — the organization
// rollup has no separate id from organizationId (see the migration's
// entity_id check constraint), and getOrCreateOrganizationForUser already
// scopes the org to this user.
export async function generateOrganizationRecommendationAction(provider: AiProviderName) {
  const parsed = generateRecommendationSchema.parse({ entityType: "organization", provider });
  const user = await requireUser();
  const supabase = await createClient();
  const namePrefix = user.email?.split("@")[0]?.trim();
  const organization = await getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);

  const recommendation = await generateRecommendation(supabase, user.id, organization.id, user.id, {
    entityType: "organization",
    entityId: null,
    provider: parsed.provider,
  });

  revalidatePath("/analytics");
  return recommendation;
}
