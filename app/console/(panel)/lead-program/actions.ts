"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { updatePlanLeadQuota } from "@/lib/db";
import { requireStaffAction } from "@/lib/staff/auth";
import { recordStaffAction } from "@/lib/staff/audit";
import { runStaffAction, StaffInputError } from "@/lib/staff/run-action";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit/check-rate-limit";
import { runVerifiedLeadAllocation, type AllocationSummary } from "@/lib/verified-leads/allocation";
import { planLeadQuotaSchema, type PlanLeadQuotaInput } from "@/lib/validations/staff";

// Owner-only. Each action re-checks the caller's staff permission and 2-step
// login itself (Server Functions are reachable by direct POST), validates
// its input, and writes the staff audit log on success.

export async function updatePlanLeadQuotaAction(input: PlanLeadQuotaInput) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("quotas:edit");
    const parsed = planLeadQuotaSchema.parse(input);
    const admin = createAdminClient();
    const { data: before, error } = await admin
      .from("plan_lead_quotas")
      .select("leads_per_month")
      .eq("plan_id", parsed.planId)
      .maybeSingle();
    if (error) throw error;
    if (!before) throw new StaffInputError("That plan has no quota row. Apply the staff console migration first.");

    await updatePlanLeadQuota(admin, parsed.planId, parsed.leadsPerMonth, session.user.id);
    await recordStaffAction(session, "quota.updated", {
      targetType: "plan",
      targetId: parsed.planId,
      metadata: { from: before.leads_per_month, to: parsed.leadsPerMonth },
    });
    revalidatePath("/console/lead-program");
    revalidatePath("/console");
    return null;
  });
}

// Same idempotent run as the daily cron: tops up every paying organization
// to this month's quota. Doesn't ping the cron heartbeat — a manual run must
// never hide a cron that has stopped firing.
export async function runAllocationNowAction() {
  return runStaffAction(async (): Promise<AllocationSummary> => {
    const session = await requireStaffAction("allocation:run");
    try {
      await checkRateLimit("staff:allocation_run", session.user.id);
    } catch (error) {
      if (error instanceof RateLimitError) throw new StaffInputError(error.message);
      throw error;
    }

    const summary = await runVerifiedLeadAllocation(createAdminClient());
    await recordStaffAction(session, "allocation.run", {
      targetType: "allocation_period",
      targetId: summary.period,
      metadata: { ...summary },
    });
    revalidatePath("/console/lead-program");
    revalidatePath("/console");
    return summary;
  });
}
