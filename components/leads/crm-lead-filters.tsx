"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDownIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_STATUSES } from "@/lib/validations/leads";
import { LEAD_VERIFICATION_STATUSES } from "@/lib/validations/lead-segments";
import {
  CRM_ENGAGEMENT_FILTERS,
  CRM_SORTS,
  MAX_COUNT_FILTER,
  QUICK_FILTERS,
  crmLeadsHref,
  type CountFilter,
  type CrmEngagementFilter,
  type CrmSearchParams,
} from "@/lib/validations/crm-leads";
import { leadStatusLabel } from "@/lib/leads/display";
import { cn } from "@/lib/utils";

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

export const ENGAGEMENT_LABEL: Record<CrmEngagementFilter, string> = {
  any: "Any engagement",
  opened: "Opened",
  not_opened: "Didn't open",
  clicked: "Clicked",
  not_clicked: "Didn't click",
  replied: "Replied",
  no_engagement: "Emailed, no engagement",
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

function countLabel(filter: CountFilter, noun: string) {
  const times = `${filter.value} time${filter.value === 1 ? "" : "s"}`;
  return `${noun} ${filter.operator === "eq" ? "exactly" : "at least"} ${times}`;
}

// "Opened [at least | exactly] [N] times". The number applies when the box
// loses focus or on Enter, so typing "12" doesn't load the page for "1".
function CountFilterField({
  id,
  label,
  noun,
  filter,
  onChange,
}: {
  id: string;
  label: string;
  noun: string;
  filter?: CountFilter;
  onChange: (filter: CountFilter | undefined) => void;
}) {
  const [operator, setOperator] = useState<CountFilter["operator"]>(filter?.operator ?? "gte");
  const [text, setText] = useState(filter ? String(filter.value) : "");

  function commit(nextOperator = operator, nextText = text) {
    const value = Number(nextText);
    const next =
      nextText.trim() === "" || !Number.isInteger(value) || value < 0
        ? undefined
        : { operator: nextOperator, value: Math.min(value, MAX_COUNT_FILTER) };
    if (next?.operator === filter?.operator && next?.value === filter?.value) return;
    onChange(next);
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Select
          value={operator}
          onValueChange={(value) => {
            const next = value as CountFilter["operator"];
            setOperator(next);
            commit(next);
          }}
        >
          <SelectTrigger className="w-28 shrink-0" aria-label={`${label}: at least or exactly`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gte">At least</SelectItem>
            <SelectItem value="eq">Exactly</SelectItem>
          </SelectContent>
        </Select>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_COUNT_FILTER}
          placeholder="Any"
          className="min-w-0"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
        <span className="shrink-0 text-sm text-muted-foreground">times</span>
      </div>
      <p className="text-xs text-muted-foreground">{noun} across all campaigns, by people only.</p>
    </div>
  );
}

// The Leads page's filters. They live in the URL (app/(app)/leads/page.tsx
// reads them), so a filtered view can be bookmarked or shared, and any
// change starts again from page 1.
export function CrmLeadFilters({
  params,
  leadLists,
  campaigns,
  steps,
  quickCounts,
  activeSegment,
  segmentNotice,
}: {
  params: CrmSearchParams;
  leadLists: { id: string; name: string }[];
  campaigns: CampaignOption[];
  // The selected campaign's steps, for "opened step 2".
  steps: StepOption[];
  // How many leads each quick filter matches, with every other filter applied.
  quickCounts: Partial<Record<CrmEngagementFilter, number>>;
  activeSegment?: { id: string; name: string };
  segmentNotice?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(params.q ?? "");
  const advancedCount = [
    params.status,
    params.list,
    params.verification,
    params.campaign,
    params.opens,
    params.clicks,
    params.engagement !== "any" && !QUICK_FILTERS.some((quick) => quick.engagement === params.engagement),
  ].filter(Boolean).length;
  const [panelOpen, setPanelOpen] = useState(advancedCount > 0);

  function go(changes: Partial<CrmSearchParams>) {
    router.push(crmLeadsHref({ ...params, page: 1, ...changes }));
  }

  const listName = params.list === "none" ? "Not in a list" : leadLists.find((list) => list.id === params.list)?.name;
  const campaignName = campaigns.find((campaign) => campaign.id === params.campaign)?.name;
  const stepLabel = steps.find((step) => step.id === params.step);
  // Each active filter as a removable pill.
  const pills: { key: string; label: string; remove: Partial<CrmSearchParams> }[] = [
    params.q ? { key: "q", label: `Search: ${params.q}`, remove: { q: undefined } } : null,
    params.engagement !== "any"
      ? { key: "engagement", label: ENGAGEMENT_LABEL[params.engagement], remove: { engagement: "any" as const } }
      : null,
    params.status ? { key: "status", label: `Status: ${leadStatusLabel(params.status)}`, remove: { status: undefined } } : null,
    params.list ? { key: "list", label: `List: ${listName ?? "Unknown"}`, remove: { list: undefined } } : null,
    params.campaign
      ? { key: "campaign", label: `Campaign: ${campaignName ?? "Unknown"}`, remove: { campaign: undefined, step: undefined } }
      : null,
    stepLabel ? { key: "step", label: `Step ${stepLabel.number}`, remove: { step: undefined } } : null,
    params.opens ? { key: "opens", label: countLabel(params.opens, "Opened"), remove: { opens: undefined } } : null,
    params.clicks ? { key: "clicks", label: countLabel(params.clicks, "Clicked"), remove: { clicks: undefined } } : null,
    params.verification
      ? { key: "verification", label: `Verification: ${VERIFICATION_LABEL[params.verification]}`, remove: { verification: undefined } }
      : null,
    activeSegment ? { key: "segment", label: `Segment: ${activeSegment.name}`, remove: { segment: undefined } } : null,
  ].filter((pill): pill is NonNullable<typeof pill> => pill !== null);

  return (
    <div className="space-y-3">
      <nav aria-label="Quick filters" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {QUICK_FILTERS.map((quick) => {
          const active = params.engagement === quick.engagement;
          const count = quickCounts[quick.engagement];
          return (
            <Link
              key={quick.engagement}
              href={crmLeadsHref({ ...params, page: 1, engagement: quick.engagement })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {quick.label}
              {count !== undefined && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <form
          role="search"
          className="relative min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: search.trim() || undefined });
          }}
        >
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => {
              if ((params.q ?? "") !== search.trim()) go({ q: search.trim() || undefined });
            }}
            placeholder="Search by name, email or company"
            aria-label="Search leads"
            className="pl-8"
          />
        </form>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={panelOpen ? "secondary" : "outline"}
            aria-expanded={panelOpen}
            aria-controls="lead-filter-panel"
            onClick={() => setPanelOpen((open) => !open)}
            className="flex-1 sm:flex-none"
          >
            <SlidersHorizontalIcon />
            Filters
            {advancedCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                {advancedCount}
              </span>
            )}
            <ChevronDownIcon className={cn("transition-transform", panelOpen && "rotate-180")} />
          </Button>
          <Select value={params.sort} onValueChange={(value) => go({ sort: value as CrmSearchParams["sort"] })}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Sort leads">
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
      </div>

      {panelOpen && (
        <div id="lead-filter-panel" className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="filter-status">Status</Label>
            <Select
              value={params.status ?? ALL}
              onValueChange={(value) => go({ status: value === ALL ? undefined : (value as CrmSearchParams["status"]) })}
            >
              <SelectTrigger id="filter-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any status</SelectItem>
                {LEAD_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {leadStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="filter-list">List</Label>
            <Select value={params.list ?? ALL} onValueChange={(value) => go({ list: value === ALL ? undefined : value })}>
              <SelectTrigger id="filter-list" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any list</SelectItem>
                <SelectItem value="none">Not in a list</SelectItem>
                {leadLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="filter-engagement">Engagement</Label>
            <Select
              value={params.engagement}
              onValueChange={(value) => go({ engagement: value as CrmSearchParams["engagement"] })}
            >
              <SelectTrigger id="filter-engagement" className="w-full">
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
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="filter-campaign">Campaign</Label>
            <Select
              value={params.campaign ?? ALL}
              onValueChange={(value) => go({ campaign: value === ALL ? undefined : value, step: undefined })}
            >
              <SelectTrigger id="filter-campaign" className="w-full min-w-0">
                <span className="min-w-0 truncate">
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any campaign</SelectItem>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="filter-step">Campaign step</Label>
            <Select
              value={params.step ?? ALL}
              onValueChange={(value) => go({ step: value === ALL ? undefined : value })}
              disabled={!params.campaign || steps.length === 0}
            >
              <SelectTrigger id="filter-step" className="w-full min-w-0">
                <span className="min-w-0 truncate">
                  <SelectValue />
                </span>
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
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="filter-verification">Email verification</Label>
            <Select
              value={params.verification ?? ALL}
              onValueChange={(value) =>
                go({ verification: value === ALL ? undefined : (value as CrmSearchParams["verification"]) })
              }
            >
              <SelectTrigger id="filter-verification" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                {LEAD_VERIFICATION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {VERIFICATION_LABEL[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <CountFilterField
            // Remounts with the URL so a removed pill clears the box.
            key={`opens-${params.opens?.operator}-${params.opens?.value}`}
            id="filter-opens"
            label="Times opened"
            noun="Opens"
            filter={params.opens}
            onChange={(opens) => go({ opens })}
          />
          <CountFilterField
            key={`clicks-${params.clicks?.operator}-${params.clicks?.value}`}
            id="filter-clicks"
            label="Times clicked"
            noun="Clicks"
            filter={params.clicks}
            onChange={(clicks) => go({ clicks })}
          />
        </div>
      )}

      {(pills.length > 0 || segmentNotice) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {pills.map((pill) => (
            <Link
              key={pill.key}
              href={crmLeadsHref({ ...params, page: 1, ...pill.remove })}
              onClick={() => {
                if (pill.key === "q") setSearch("");
              }}
              className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {pill.label}
              <XIcon aria-hidden className="size-3" />
              <span className="sr-only">(remove this filter)</span>
            </Link>
          ))}
          {pills.length > 1 && (
            <Link
              href={crmLeadsHref({ sort: params.sort })}
              onClick={() => setSearch("")}
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Clear all
            </Link>
          )}
          {segmentNotice && (
            <p role="status" className="text-xs text-muted-foreground">
              {segmentNotice} Showing leads without it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
