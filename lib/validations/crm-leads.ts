import { z } from "zod";
import { LEAD_STATUSES } from "@/lib/validations/leads";
import { LEAD_VERIFICATION_STATUSES } from "@/lib/validations/lead-segments";

// Engagement filters crm_leads() understands
// (supabase/migrations/20261113100000_crm_sequences.sql).
export const CRM_ENGAGEMENT_FILTERS = [
  "any",
  "opened",
  "not_opened",
  "clicked",
  "not_clicked",
  "replied",
  "no_engagement",
  "never_contacted",
] as const;
export type CrmEngagementFilter = (typeof CRM_ENGAGEMENT_FILTERS)[number];

export const CRM_SORTS = ["recent", "activity", "opens", "clicks", "name", "company"] as const;
export type CrmSort = (typeof CRM_SORTS)[number];

// The Leads page's filters, from its URL. Anything invalid is dropped
// rather than rejected, so a stale or hand-edited link still shows leads.
export interface CrmSearchParams {
  page: number;
  q?: string;
  status?: (typeof LEAD_STATUSES)[number];
  list?: string;
  verification?: (typeof LEAD_VERIFICATION_STATUSES)[number];
  segment?: string;
  engagement: CrmEngagementFilter;
  campaign?: string;
  step?: string;
  sort: CrmSort;
}

const uuid = z.string().uuid();

function pick<const T extends readonly string[]>(values: T, raw: unknown): T[number] | undefined {
  return values.find((value) => value === raw);
}

export function parseCrmSearchParams(raw: Record<string, string | string[] | undefined>): CrmSearchParams {
  const value = (key: string) => {
    const entry = raw[key];
    return Array.isArray(entry) ? entry[0] : entry;
  };
  const page = Number(value("page"));
  const q = value("q")?.trim().slice(0, 100);
  const list = value("list");
  const campaign = uuid.safeParse(value("campaign")).success ? value("campaign") : undefined;
  // A step only narrows a campaign's engagement.
  const step = campaign && uuid.safeParse(value("step")).success ? value("step") : undefined;

  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    q: q || undefined,
    status: pick(LEAD_STATUSES, value("status")),
    list: list === "none" || uuid.safeParse(list).success ? list : undefined,
    verification: pick(LEAD_VERIFICATION_STATUSES, value("verification")),
    segment: uuid.safeParse(value("segment")).success ? value("segment") : undefined,
    engagement: pick(CRM_ENGAGEMENT_FILTERS, value("engagement")) ?? "any",
    campaign,
    step,
    sort: pick(CRM_SORTS, value("sort")) ?? "recent",
  };
}

// The URL for a set of filters. Defaults are left out, and any filter change
// starts again from page 1 unless a page is given.
export function crmLeadsHref(params: Partial<CrmSearchParams>): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.status) search.set("status", params.status);
  if (params.list) search.set("list", params.list);
  if (params.verification) search.set("verification", params.verification);
  if (params.segment) search.set("segment", params.segment);
  if (params.engagement && params.engagement !== "any") search.set("engagement", params.engagement);
  if (params.campaign) search.set("campaign", params.campaign);
  if (params.campaign && params.step) search.set("step", params.step);
  if (params.sort && params.sort !== "recent") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/leads?${query}` : "/leads";
}

// Which leads a bulk action applies to: the ones ticked on the page, or
// every lead matching the page's filters (its query string, re-parsed and
// resolved on the server, capped at BULK_LEAD_LIMIT).
export const BULK_LEAD_LIMIT = 10000;

export const bulkLeadTargetSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ query: z.string().max(2000) }),
]);
export type BulkLeadTarget = z.infer<typeof bulkLeadTargetSchema>;

export const bulkMoveToListSchema = z.object({
  target: bulkLeadTargetSchema,
  // A list's id, or "" to take the leads out of any list.
  listId: z.string().uuid().or(z.literal("")),
});

export const bulkSetStatusSchema = z.object({
  target: bulkLeadTargetSchema,
  status: z.enum(LEAD_STATUSES),
});

export const leadNoteSchema = z.object({
  body: z.string().trim().min(1, { message: "Write a note first." }).max(5000),
});
