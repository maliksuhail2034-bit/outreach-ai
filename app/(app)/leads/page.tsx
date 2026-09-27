import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  countLeads,
  countLeadsInList,
  countLeadsMatchingRules,
  listLeadLists,
  listLeadSegments,
  listLeadsPage,
} from "@/lib/db";
import {
  LEAD_VERIFICATION_STATUSES,
  leadSegmentRulesSchema,
  type LeadVerificationStatus,
} from "@/lib/validations/lead-segments";
import { FadeIn } from "@/components/motion/fade-in";
import { LeadListsPanel } from "@/components/leads/lead-lists-panel";
import { LeadTable } from "@/components/leads/lead-table";
import { SegmentsPanel } from "@/components/leads/segments-panel";

// Scalability Track, Phase D, Step 3 (item 8): page number driven by a URL
// search param rather than client state, so a Server Component page can
// refetch server-side on navigation — same shape the analytics pages
// already use for their date-range params. Batch D: the segment and
// verification-status filters work the same way, applied in the query so
// pagination and totals describe the filtered set.
function parsePage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseVerificationStatus(raw: string | undefined): LeadVerificationStatus | undefined {
  return LEAD_VERIFICATION_STATUSES.find((status) => status === raw);
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; segment?: string; verification?: string }>;
}) {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const { page: pageParam, segment: segmentParam, verification: verificationParam } = await searchParams;
  const page = parsePage(pageParam);
  const verificationStatus = parseVerificationStatus(verificationParam);

  const supabase = await createClient();
  const [leadLists, segments] = await Promise.all([
    listLeadLists(supabase, user.id),
    listLeadSegments(supabase, user.id),
  ]);

  // Only one of the caller's own segments can filter (the list above is
  // scoped to them), and only once its stored rules re-validate.
  const segmentsWithRules = (segments ?? []).map((segment) => {
    const rules = leadSegmentRulesSchema.safeParse(segment.rules);
    return { segment, rules: rules.success ? rules.data : null };
  });
  const requestedSegment = segmentParam
    ? segmentsWithRules.find(({ segment }) => segment.id === segmentParam)
    : undefined;
  const activeSegment = requestedSegment?.rules ? requestedSegment : undefined;
  const segmentNotice = !segmentParam || activeSegment
    ? undefined
    : requestedSegment
      ? "This segment's rules are no longer valid. Edit it to use it again. Showing all leads."
      : "That segment wasn't found. Showing all leads.";

  const filtersActive = Boolean(activeSegment || verificationStatus);

  const [{ leads, pageSize, totalCount }, accountLeadCount, leadListsWithCounts, segmentsWithCounts] = await Promise.all([
    listLeadsPage(supabase, user.id, {
      page,
      rules: activeSegment?.rules ?? undefined,
      verificationStatus,
    }),
    filtersActive ? countLeads(supabase, user.id) : null,
    Promise.all(
      (leadLists ?? []).map(async (list) => ({
        ...list,
        leadCount: await countLeadsInList(supabase, user.id, list.id),
      })),
    ),
    Promise.all(
      segmentsWithRules.map(async ({ segment, rules }) => ({
        ...segment,
        matchCount: rules ? await countLeadsMatchingRules(supabase, user.id, rules) : null,
      })),
    ),
  ]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Manage individual prospects, the lists that group them, and segments that match them by rules.
          </p>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-3">
        <FadeIn delay={0.05} className="min-w-0 lg:col-span-2">
          <LeadTable
            leads={leads}
            leadLists={leadLists ?? []}
            leadCount={totalCount}
            accountLeadCount={accountLeadCount ?? totalCount}
            page={page}
            pageSize={pageSize}
            verificationStatus={verificationStatus}
            activeSegment={activeSegment ? { id: activeSegment.segment.id, name: activeSegment.segment.name } : undefined}
            segmentNotice={segmentNotice}
          />
        </FadeIn>
        <FadeIn delay={0.1} className="space-y-6 lg:col-span-1">
          <SegmentsPanel
            segments={segmentsWithCounts}
            leadLists={leadLists ?? []}
            activeSegmentId={activeSegment?.segment.id}
          />
          <LeadListsPanel leadLists={leadListsWithCounts} />
        </FadeIn>
      </div>
    </div>
  );
}
