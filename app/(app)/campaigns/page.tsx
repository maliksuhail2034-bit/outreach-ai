import Link from "next/link";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listCampaignsPage, listMailboxes } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { CampaignList } from "@/components/campaigns/campaign-list";

// Scalability Track, Phase D, Step 3 (item 9) — same URL-search-param-driven
// pagination shape as app/(app)/leads/page.tsx.
function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  const supabase = await createClient();
  const [{ campaigns, pageSize, totalCount }, mailboxes] = await Promise.all([
    listCampaignsPage(supabase, user.id, { page }),
    listMailboxes(supabase, user.id),
  ]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Group leads and a sending mailbox into an outbound campaign.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/campaigns/compare">Compare campaigns</Link>
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <CampaignList campaigns={campaigns} mailboxes={mailboxes} page={page} pageSize={pageSize} totalCount={totalCount} />
      </FadeIn>
    </div>
  );
}
