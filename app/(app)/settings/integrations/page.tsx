import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization, listIntegrations } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { IntegrationsPanel } from "@/components/settings/integrations-panel";

export default async function IntegrationsPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const integrations = await listIntegrations(supabase, organization.id);

  return (
    <div className="max-w-2xl space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Integrations</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Send your organization&apos;s overview and AI Insights to an external destination on a schedule.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <IntegrationsPanel integrations={integrations} />
      </FadeIn>
    </div>
  );
}
