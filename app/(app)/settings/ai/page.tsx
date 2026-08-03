import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateOrganizationForUser, listAiProviderKeys } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { AiProvidersPanel } from "@/components/settings/ai-providers-panel";

export default async function AiSettingsPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const namePrefix = user.email?.split("@")[0]?.trim();
  const organization = await getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);

  const providerKeys = await listAiProviderKeys(supabase, organization.id);

  return (
    <div className="max-w-2xl space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Connect your own Claude, OpenAI, or Gemini API key to generate AI Recommendations on your analytics
            pages. Outreach-ai never sees your key in plain text, stores no managed key of its own, and only
            generates a recommendation when you click &quot;Generate Recommendation.&quot;
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <AiProvidersPanel providerKeys={providerKeys} />
      </FadeIn>
    </div>
  );
}
