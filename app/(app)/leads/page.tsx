import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { countLeadsInList, listLeadLists, listLeads } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { LeadListsPanel } from "@/components/leads/lead-lists-panel";
import { LeadTable } from "@/components/leads/lead-table";

export default async function LeadsPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const [leads, leadLists] = await Promise.all([
    listLeads(supabase, user.id),
    listLeadLists(supabase, user.id),
  ]);

  const leadListsWithCounts = await Promise.all(
    (leadLists ?? []).map(async (list) => ({
      ...list,
      leadCount: await countLeadsInList(supabase, user.id, list.id),
    })),
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Manage individual prospects and the lists that group them.
          </p>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-3">
        <FadeIn delay={0.05} className="lg:col-span-2">
          <LeadTable leads={leads ?? []} leadLists={leadLists ?? []} />
        </FadeIn>
        <FadeIn delay={0.1} className="lg:col-span-1">
          <LeadListsPanel leadLists={leadListsWithCounts} />
        </FadeIn>
      </div>
    </div>
  );
}
