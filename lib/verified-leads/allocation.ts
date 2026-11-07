import type { Client } from "@/lib/db/shared";
import { allocateVerifiedLeads, listPlanLeadQuotas } from "@/lib/db";
import { getPlanForOrganization, isInternalUnlimitedOrganization } from "@/lib/billing/resolve-plan";
import { captureError } from "@/lib/monitoring/error-tracking";
import { errorMessage } from "@/lib/monitoring/error-message";
import { periodFor } from "./period";

export interface AllocationSummary {
  period: string;
  organizations: number;
  eligible: number;
  delivered: number;
  // Paying organizations that got fewer leads than their quota this run
  // because the pool ran short.
  shortfalls: number;
  failed: number;
}

const ORG_PAGE = 1000;

async function listOrganizations(supabase: Client) {
  const rows: { id: string; owner_user_id: string }[] = [];
  for (let from = 0; ; from += ORG_PAGE) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, owner_user_id")
      .order("created_at", { ascending: true })
      .range(from, from + ORG_PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < ORG_PAGE) return rows;
  }
}

// A run is degraded when any organization failed, or the pool couldn't fill
// someone's quota — sales needs to upload more leads.
export function allocationDegraded(summary: AllocationSummary): string | null {
  const reasons: string[] = [];
  if (summary.failed > 0) reasons.push(`${summary.failed} organization(s) failed`);
  if (summary.shortfalls > 0) reasons.push(`pool ran short for ${summary.shortfalls} organization(s)`);
  return reasons.length > 0 ? `Verified-lead allocation ${summary.period}: ${reasons.join("; ")}` : null;
}

// Daily: gives every paying organization its plan's verified-lead quota for
// the current calendar month (UTC). Idempotent per organization and month,
// and tops up after a mid-month upgrade (allocate_verified_leads()). Runs on
// the service-role client (cron or the owner's "run now").
export async function runVerifiedLeadAllocation(supabase: Client, now: Date = new Date()): Promise<AllocationSummary> {
  const period = periodFor(now);
  const quotas = new Map((await listPlanLeadQuotas(supabase)).map((row) => [row.plan_id, row.leads_per_month]));
  const organizations = await listOrganizations(supabase);
  const summary: AllocationSummary = { period, organizations: organizations.length, eligible: 0, delivered: 0, shortfalls: 0, failed: 0 };

  for (const organization of organizations) {
    // Polimatiq's own internal workspace isn't a paying customer.
    if (isInternalUnlimitedOrganization(organization.id)) continue;
    try {
      const plan = await getPlanForOrganization(supabase, organization.id);
      const quota = quotas.get(plan.id) ?? 0;
      if (quota <= 0) continue;
      summary.eligible += 1;

      const delivered = await allocateVerifiedLeads(supabase, {
        organizationId: organization.id,
        userId: organization.owner_user_id,
        period,
        planId: plan.id,
        quota,
      });
      summary.delivered += delivered;

      const { data: allocation, error } = await supabase
        .from("verified_lead_allocations")
        .select("delivered_count, quota")
        .eq("organization_id", organization.id)
        .eq("period", period)
        .maybeSingle();
      if (error) throw error;
      if (allocation && allocation.delivered_count < allocation.quota) summary.shortfalls += 1;
    } catch (error) {
      summary.failed += 1;
      const message = errorMessage(error, "Unknown allocation error.");
      console.error("[verified-leads] allocation failed", { organizationId: organization.id, error: message });
      await captureError({ job: "verified-leads", message: `Allocation failed: ${message}`, context: { organizationId: organization.id, period } });
    }
  }

  return summary;
}
