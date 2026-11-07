import Link from "next/link";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  countCrmLeads,
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
import { QUICK_FILTERS, crmLeadsHref, parseCrmSearchParams, type CrmView } from "@/lib/validations/crm-leads";
import { cn } from "@/lib/utils";
import { FadeIn } from "@/components/motion/fade-in";
import { CrmLeadFilters, type StepOption } from "@/components/leads/crm-lead-filters";
import { LeadListsPanel } from "@/components/leads/lead-lists-panel";
import { LeadTable } from "@/components/leads/lead-table";
import { SegmentsPanel } from "@/components/leads/segments-panel";

// The Leads page is a CRM view with three tabs: the leads themselves, the
// lists that group them and the segments that match them by rules. Every
// filter lives in the URL (lib/validations/crm-leads.ts) and is applied in
// the query, so pagination and totals describe the filtered set and a view
// can be bookmarked.
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

  const view: CrmView = params.view;
  const [{ leads, page, pageSize, totalCount }, accountLeadCount, quickCountEntries, segmentsWithCounts, allocation] =
    await Promise.all([
      listCrmLeadsPage(supabase, user.id, filters, params.page),
      countLeads(supabase, user.id),
      // Each quick filter's count, with every other filter applied: the number
      // on a chip is what the table shows once it's clicked.
      view === "leads"
        ? Promise.all(
            QUICK_FILTERS.map(
              async (quick) =>
                [quick.engagement, await countCrmLeads(supabase, user.id, { ...filters, engagement: quick.engagement })] as const,
            ),
          )
        : Promise.resolve([]),
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

  const tabs: { view: CrmView; label: string; count: number; href: string }[] = [
    { view: "leads", label: "Leads", count: accountLeadCount, href: "/leads" },
    { view: "lists", label: "Lists", count: leadLists.length, href: crmLeadsHref({ view: "lists" }) },
    { view: "segments", label: "Segments", count: segmentsWithCounts.length, href: crmLeadsHref({ view: "segments" }) },
  ];

  return (
    <div className="space-y-6">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Your contacts and how they engage: who opened, clicked and replied, in any campaign.
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

      <nav aria-label="Leads sections" className="flex gap-1 border-b border-border">
        {tabs.map((tab) => {
          const active = tab.view === view;
          return (
            <Link
              key={tab.view}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{tab.count}</span>
            </Link>
          );
        })}
      </nav>

      {view === "leads" && (
        <FadeIn className="min-w-0 space-y-4">
          <CrmLeadFilters
            // Remounts the search box and filter fields when the URL changes them (e.g. "Clear all").
            key={params.q ?? ""}
            params={params}
            leadLists={leadLists}
            campaigns={campaignOptions}
            steps={steps}
            quickCounts={Object.fromEntries(quickCountEntries)}
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
      )}

      {view === "lists" && (
        <FadeIn>
          <LeadListsPanel leadLists={leadLists} />
        </FadeIn>
      )}

      {view === "segments" && (
        <FadeIn>
          <SegmentsPanel segments={segmentsWithCounts} leadLists={leadLists} activeSegmentId={activeSegment?.id} />
        </FadeIn>
      )}
    </div>
  );
}
