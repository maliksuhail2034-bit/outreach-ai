import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import { listAllCrmLeads, listLeadSegments, listLeadsByIds, type CrmLeadFilters } from "@/lib/db";
import { leadSegmentRulesSchema } from "@/lib/validations/lead-segments";
import {
  BULK_LEAD_LIMIT,
  parseCrmSearchParams,
  type BulkLeadTarget,
  type CrmSearchParams,
} from "@/lib/validations/crm-leads";

export interface ResolvedCrmFilters {
  filters: CrmLeadFilters;
  activeSegment?: { id: string; name: string };
  // Why a requested segment isn't applied, for the page to say.
  segmentNotice?: string;
}

// The Leads page's URL filters as a lead query. Used by the page itself and
// by bulk actions on "all leads matching these filters", so both always
// mean the same leads. Only one of the caller's own segments can filter,
// and only once its stored rules re-validate.
export async function resolveCrmFilters(supabase: Client, userId: string, params: CrmSearchParams): Promise<ResolvedCrmFilters> {
  let rules: CrmLeadFilters["rules"];
  let activeSegment: ResolvedCrmFilters["activeSegment"];
  let segmentNotice: string | undefined;

  if (params.segment) {
    const segments = await listLeadSegments(supabase, userId);
    const segment = (segments ?? []).find((candidate) => candidate.id === params.segment);
    const parsed = segment ? leadSegmentRulesSchema.safeParse(segment.rules) : undefined;
    if (segment && parsed?.success) {
      rules = parsed.data;
      activeSegment = { id: segment.id, name: segment.name };
    } else {
      segmentNotice = segment
        ? "This segment's rules are no longer valid. Edit it to use it again."
        : "That segment wasn't found.";
    }
  }

  return {
    filters: {
      search: params.q,
      status: params.status,
      listId: params.list,
      verificationStatus: params.verification,
      rules,
      engagement: params.engagement,
      campaignId: params.campaign,
      stepId: params.step,
      opens: params.opens,
      clicks: params.clicks,
      sort: params.sort,
    },
    activeSegment,
    segmentNotice,
  };
}

// The caller's leads a bulk action applies to: the ticked ones, or every
// lead matching the page's filters (its query string, parsed exactly as the
// page parses it). An invalid segment in the query matches nothing rather
// than silently widening to every lead.
export async function resolveBulkLeads(supabase: Client, userId: string, target: BulkLeadTarget): Promise<Tables<"leads">[]> {
  if ("ids" in target) return listLeadsByIds(supabase, userId, target.ids);

  const params = parseCrmSearchParams(Object.fromEntries(new URLSearchParams(target.query)));
  const { filters, segmentNotice } = await resolveCrmFilters(supabase, userId, params);
  if (segmentNotice) return [];
  return listAllCrmLeads(supabase, userId, filters, BULK_LEAD_LIMIT);
}
