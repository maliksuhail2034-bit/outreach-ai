import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  countLeads,
  countLeadsMatchingRules,
  getOrganizationAllocation,
  getUserOrganization,
  listCampaigns,
  listCrmLeadsPage,
  listLeadListsWithCounts,
  listLeadSegments,
  listSequenceSteps,
  listSequences,
} from "@/lib/db";
import { optionalRead } from "@/lib/db/resilient-read";
import { resolveCrmFilters } from "@/lib/leads/crm-filters";
import { periodFor } from "@/lib/verified-leads/period";
import { leadSegmentRulesSchema } from "@/lib/validations/lead-segments";
import { parseCrmSearchParams } from "@/lib/validations/crm-leads";
import { FadeIn } from "@/components/motion/fade-in";
import { CrmLeadFilters, type StepOption } from "@/components/leads/crm-lead-filters";
import { LeadListsPanel } from "@/components/leads/lead-lists-panel";
import { LeadTable } from "@/components/leads/lead-table";
import { SegmentsPanel } from "@/components/leads/segments-panel";

// The Leads page is a CRM view: every filter lives in the URL (see
// lib/validations/crm-leads.ts) and is applied in the query, so pagination
// and totals describe the filtered set and a view can be bookmarked.
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const params = parseCrmSearchParams(await searchParams);
  const supabase = await createClient();

  const [{ filters, activeSegment, segmentNotice }, leadLists, segments, campaigns] = await Promise.all([
    resolveCrmFilters(supabase, user.id, params),
    // One query for the lists and each list's lead count.
    listLeadListsWithCounts(supabase, user.id),
    listLeadSegments(supabase, user.id),
    listCampaigns(supabase, user.id),
  ]);

  // The chosen campaign's steps, for "opened step 2" (only the caller's own
  // campaign: it must be in their list).
  const filterCampaign = params.campaign ? (campaigns ?? []).find((campaign) => campaign.id === params.campaign) : undefined;
  const steps: StepOption[] = filterCampaign
    ? await (async () => {
        const sequences = await listSequences(supabase, filterCampaign.id);
        const rows = sequences[0] ? await listSequenceSteps(supabase, sequences[0].id) : [];
        return [...rows]
          .sort((a, b) => a.step_order - b.step_order)
          .map((step, index) => ({ id: step.id, number: index + 1, subject: step.subject }));
      })()
    : [];

  const [{ leads, page, pageSize, totalCount }, accountLeadCount, segmentsWithCounts, allocation] = await Promise.all([
    listCrmLeadsPage(supabase, user.id, filters, params.page),
    countLeads(supabase, user.id),
    Promise.all(
      (segments ?? []).map(async (segment) => {
        const rules = leadSegmentRulesSchema.safeParse(segment.rules);
        return {
          ...segment,
          matchCount: rules.success ? await countLeadsMatchingRules(supabase, user.id, rules.data) : null,
        };
      }),
    ),
    // This month's Polimatiq verified-lead delivery, if the plan includes one.
    optionalRead(async () => {
      const organization = await getUserOrganization(supabase, user);
      return getOrganizationAllocation(supabase, organization.id, periodFor());
    }, null),
  ]);

  const campaignOptions = (campaigns ?? []).map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
  }));

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            See who opened, clicked and replied, filter by any campaign step, and act on many leads at once.
          </p>
          {allocation.data && allocation.data.quota > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Verified leads this month: {allocation.data.delivered_count} of {allocation.data.quota} delivered by
              Polimatiq. Their addresses are masked and stay inside Polimatiq, and they don&apos;t count toward your
              plan&apos;s lead limit.
            </p>
          )}
        </div>
      </FadeIn>

      <FadeIn delay={0.05} className="min-w-0 space-y-4">
        <CrmLeadFilters
          // Remounts the search box when the URL's search changes (e.g. "Clear filters").
          key={params.q ?? ""}
          params={params}
          leadLists={leadLists}
          campaigns={campaignOptions}
          steps={steps}
          activeSegment={activeSegment}
          segmentNotice={segmentNotice}
        />
        <LeadTable
          leads={leads}
          leadLists={leadLists}
          campaigns={campaignOptions}
          params={params}
          leadCount={totalCount}
          accountLeadCount={accountLeadCount}
          page={page}
          pageSize={pageSize}
          now={new Date().toISOString()}
        />
      </FadeIn>

      <FadeIn delay={0.1} className="grid gap-6 lg:grid-cols-2">
        <SegmentsPanel segments={segmentsWithCounts} leadLists={leadLists} activeSegmentId={activeSegment?.id} />
        <LeadListsPanel leadLists={leadLists} />
      </FadeIn>
    </div>
  );
}
