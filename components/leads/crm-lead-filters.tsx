"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_STATUSES } from "@/lib/validations/leads";
import { LEAD_VERIFICATION_STATUSES } from "@/lib/validations/lead-segments";
import { CRM_ENGAGEMENT_FILTERS, CRM_SORTS, crmLeadsHref, type CrmSearchParams } from "@/lib/validations/crm-leads";
import { leadStatusLabel } from "@/lib/leads/display";

export interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

export interface StepOption {
  id: string;
  number: number;
  subject: string | null;
}

// Radix Select can't hold "" as a value.
const ALL = "all";

export const ENGAGEMENT_LABEL: Record<(typeof CRM_ENGAGEMENT_FILTERS)[number], string> = {
  any: "Any engagement",
  opened: "Opened",
  not_opened: "Didn't open",
  clicked: "Clicked",
  not_clicked: "Didn't click",
  replied: "Replied",
  no_engagement: "Sent, no engagement",
  never_contacted: "Never emailed",
};

const SORT_LABEL: Record<(typeof CRM_SORTS)[number], string> = {
  recent: "Newest first",
  activity: "Latest activity",
  opens: "Most opens",
  clicks: "Most clicks",
  name: "Name A-Z",
  company: "Company A-Z",
};

export const VERIFICATION_LABEL: Record<string, string> = {
  unverified: "Unverified",
  pending: "Pending",
  valid: "Valid",
  invalid: "Invalid",
  catch_all: "Catch-all",
  unknown: "Unknown",
  error: "Error",
};

// The Leads page's filters. They live in the URL (app/(app)/leads/page.tsx
// reads them), so a filtered view can be bookmarked or shared, and any
// change starts again from page 1.
export function CrmLeadFilters({
  params,
  leadLists,
  campaigns,
  steps,
  activeSegment,
  segmentNotice,
}: {
  params: CrmSearchParams;
  leadLists: { id: string; name: string }[];
  campaigns: CampaignOption[];
  // The selected campaign's steps, for "opened step 2".
  steps: StepOption[];
  activeSegment?: { id: string; name: string };
  segmentNotice?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(params.q ?? "");

  function go(changes: Partial<CrmSearchParams>) {
    router.push(crmLeadsHref({ ...params, page: 1, ...changes }));
  }

  const filtersActive = Boolean(
    params.q ||
      params.status ||
      params.list ||
      params.verification ||
      params.segment ||
      params.engagement !== "any" ||
      params.campaign,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <form
          role="search"
          className="relative min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: search.trim() || undefined });
          }}
        >
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => {
              if ((params.q ?? "") !== search.trim()) go({ q: search.trim() || undefined });
            }}
            placeholder="Search name, email or company, then press Enter"
            aria-label="Search leads"
            className="pl-8"
          />
        </form>
        <Select value={params.sort} onValueChange={(value) => go({ sort: value as CrmSearchParams["sort"] })}>
          <SelectTrigger className="w-full lg:w-44" aria-label="Sort leads">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRM_SORTS.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {SORT_LABEL[sort]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Select
          value={params.status ?? ALL}
          onValueChange={(value) => go({ status: value === ALL ? undefined : (value as CrmSearchParams["status"]) })}
        >
          <SelectTrigger className="w-full" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {LEAD_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {leadStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={params.list ?? ALL} onValueChange={(value) => go({ list: value === ALL ? undefined : value })}>
          <SelectTrigger className="w-full" aria-label="Filter by list">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All lists</SelectItem>
            <SelectItem value="none">Not in a list</SelectItem>
            {leadLists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.engagement}
          onValueChange={(value) => go({ engagement: value as CrmSearchParams["engagement"] })}
        >
          <SelectTrigger className="w-full" aria-label="Filter by engagement">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRM_ENGAGEMENT_FILTERS.map((engagement) => (
              <SelectItem key={engagement} value={engagement}>
                {ENGAGEMENT_LABEL[engagement]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.campaign ?? ALL}
          onValueChange={(value) => go({ campaign: value === ALL ? undefined : value, step: undefined })}
        >
          <SelectTrigger className="w-full" aria-label="Filter by campaign">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All campaigns</SelectItem>
            {campaigns.map((campaign) => (
              <SelectItem key={campaign.id} value={campaign.id}>
                {campaign.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.step ?? ALL}
          onValueChange={(value) => go({ step: value === ALL ? undefined : value })}
          disabled={!params.campaign || steps.length === 0}
        >
          <SelectTrigger className="w-full" aria-label="Filter by campaign step">
            <SelectValue placeholder="Any step" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{params.campaign ? "Any step" : "Choose a campaign first"}</SelectItem>
            {steps.map((step) => (
              <SelectItem key={step.id} value={step.id}>
                Step {step.number}
                {step.subject ? `: ${step.subject}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={params.verification ?? ALL}
          onValueChange={(value) =>
            go({ verification: value === ALL ? undefined : (value as CrmSearchParams["verification"]) })
          }
        >
          <SelectTrigger className="w-full" aria-label="Filter by verification status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any verification</SelectItem>
            {LEAD_VERIFICATION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {VERIFICATION_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(filtersActive || segmentNotice) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {activeSegment && <Badge variant="secondary">Segment: {activeSegment.name}</Badge>}
          {segmentNotice && (
            <p role="status" className="text-muted-foreground">
              {segmentNotice} Showing leads without it.
            </p>
          )}
          {filtersActive && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
              <Link href={crmLeadsHref({ sort: params.sort })} onClick={() => setSearch("")}>
                <XIcon />
                Clear filters
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
