import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization, listMailboxes, listWarmupProfiles } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { FadeIn } from "@/components/motion/fade-in";
import { WarmupDashboard } from "@/components/warmup/warmup-dashboard";

export default async function WarmupPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const [mailboxes, profiles] = await Promise.all([
    listMailboxes(supabase, user.id),
    listWarmupProfiles(supabase, organization.id),
  ]);

  // Plain object, not a Map — this crosses the Server -> Client Component
  // boundary as a prop, which only supports serializable values.
  const profileByMailbox: Record<string, Tables<"warmup_profiles">> = {};
  for (const profile of profiles) {
    profileByMailbox[profile.mailbox_id] = profile;
  }

  return (
    <div className="max-w-4xl space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Warmup</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Gradually ramp sending volume on new mailboxes to build inbox reputation.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <WarmupDashboard mailboxes={mailboxes} profileByMailbox={profileByMailbox} />
      </FadeIn>
    </div>
  );
}
