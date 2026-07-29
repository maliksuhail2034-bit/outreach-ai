import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listCampaigns, listMailboxes } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { CampaignList } from "@/components/campaigns/campaign-list";

export default async function CampaignsPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const [campaigns, mailboxes] = await Promise.all([
    listCampaigns(supabase, user.id),
    listMailboxes(supabase, user.id),
  ]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Group leads and a sending mailbox into an outbound campaign.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <CampaignList campaigns={campaigns ?? []} mailboxes={mailboxes} />
      </FadeIn>
    </div>
  );
}
