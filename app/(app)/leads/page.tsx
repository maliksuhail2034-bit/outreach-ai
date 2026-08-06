import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { countLeadsInList, listLeadLists, listLeadsPage } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { LeadListsPanel } from "@/components/leads/lead-lists-panel";
import { LeadTable } from "@/components/leads/lead-table";

// Scalability Track, Phase D, Step 3 (item 8): page number driven by a URL
// search param rather than client state, so a Server Component page can
// refetch server-side on navigation — same shape the analytics pages
// already use for their date-range params.
function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function LeadsPage({
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
  const [{ leads, pageSize, totalCount }, leadLists] = await Promise.all([
    listLeadsPage(supabase, user.id, { page }),
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
          <LeadTable
            leads={leads}
            leadLists={leadLists ?? []}
            leadCount={totalCount}
            page={page}
            pageSize={pageSize}
          />
        </FadeIn>
        <FadeIn delay={0.1} className="lg:col-span-1">
          <LeadListsPanel leadLists={leadListsWithCounts} />
        </FadeIn>
      </div>
    </div>
  );
}
