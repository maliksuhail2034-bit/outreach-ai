import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class StaffAccessError extends Error {}
  return {
    StaffAccessError,
    requireStaffAction: vi.fn(),
    recordStaffAction: vi.fn(),
    updatePlanLeadQuota: vi.fn(),
    checkRateLimit: vi.fn(),
    runVerifiedLeadAllocation: vi.fn(),
    revalidatePath: vi.fn(),
    quotaRow: { data: { leads_per_month: 100 } as { leads_per_month: number } | null, error: null as unknown },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/staff/auth", () => ({ requireStaffAction: mocks.requireStaffAction, StaffAccessError: mocks.StaffAccessError }));
vi.mock("@/lib/staff/audit", () => ({ recordStaffAction: mocks.recordStaffAction }));
vi.mock("@/lib/db", () => ({ updatePlanLeadQuota: mocks.updatePlanLeadQuota }));
vi.mock("@/lib/verified-leads/allocation", () => ({ runVerifiedLeadAllocation: mocks.runVerifiedLeadAllocation }));
vi.mock("@/lib/rate-limit/check-rate-limit", async () => {
  class RateLimitError extends Error {
    constructor(public readonly retryAfterSeconds: number) {
      super(`Too many attempts. Try again in ${retryAfterSeconds} seconds.`);
    }
  }
  return { checkRateLimit: mocks.checkRateLimit, RateLimitError };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => mocks.quotaRow };
      return chain;
    },
  }),
}));

import { RateLimitError } from "@/lib/rate-limit/check-rate-limit";
import { runAllocationNowAction, updatePlanLeadQuotaAction } from "./actions";

const OWNER = { user: { id: "owner-1" }, role: "owner" as const };
const SUMMARY = { period: "2026-11", organizations: 5, eligible: 3, delivered: 250, shortfalls: 1, failed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.quotaRow = { data: { leads_per_month: 100 }, error: null };
  mocks.requireStaffAction.mockResolvedValue(OWNER);
  mocks.checkRateLimit.mockResolvedValue(undefined);
  mocks.runVerifiedLeadAllocation.mockResolvedValue(SUMMARY);
});

describe("updatePlanLeadQuotaAction", () => {
  it("requires the owner-only quotas permission and audits the change", async () => {
    await expect(updatePlanLeadQuotaAction({ planId: "starter", leadsPerMonth: 150 })).resolves.toEqual({ ok: true, data: null });
    expect(mocks.requireStaffAction).toHaveBeenCalledWith("quotas:edit");
    expect(mocks.updatePlanLeadQuota).toHaveBeenCalledWith(expect.anything(), "starter", 150, "owner-1");
    expect(mocks.recordStaffAction).toHaveBeenCalledWith(OWNER, "quota.updated", {
      targetType: "plan",
      targetId: "starter",
      metadata: { from: 100, to: 150 },
    });
  });

  it("refuses a caller without the permission before touching anything", async () => {
    mocks.requireStaffAction.mockRejectedValue(new mocks.StaffAccessError("You don't have access to do that."));
    await expect(updatePlanLeadQuotaAction({ planId: "pro", leadsPerMonth: 5 })).resolves.toEqual({
      ok: false,
      error: "You don't have access to do that.",
    });
    expect(mocks.updatePlanLeadQuota).not.toHaveBeenCalled();
    expect(mocks.recordStaffAction).not.toHaveBeenCalled();
  });

  it.each([
    [{ planId: "pro", leadsPerMonth: -1 }],
    [{ planId: "pro", leadsPerMonth: 1.5 }],
    [{ planId: "pro", leadsPerMonth: 100_001 }],
    [{ planId: "enterprise", leadsPerMonth: 10 }],
  ])("rejects invalid input %j", async (input) => {
    const result = await updatePlanLeadQuotaAction(input as never);
    expect(result.ok).toBe(false);
    expect(mocks.updatePlanLeadQuota).not.toHaveBeenCalled();
  });

  it("explains a missing quota row instead of failing generically", async () => {
    mocks.quotaRow = { data: null, error: null };
    const result = await updatePlanLeadQuotaAction({ planId: "scale", leadsPerMonth: 10 });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/migration/) });
  });
});

describe("runAllocationNowAction", () => {
  it("runs the allocation, audits the summary and returns it", async () => {
    await expect(runAllocationNowAction()).resolves.toEqual({ ok: true, data: SUMMARY });
    expect(mocks.requireStaffAction).toHaveBeenCalledWith("allocation:run");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("staff:allocation_run", "owner-1");
    expect(mocks.recordStaffAction).toHaveBeenCalledWith(OWNER, "allocation.run", {
      targetType: "allocation_period",
      targetId: "2026-11",
      metadata: SUMMARY,
    });
  });

  it("shows the rate-limit message and doesn't run", async () => {
    mocks.checkRateLimit.mockRejectedValue(new RateLimitError(60));
    await expect(runAllocationNowAction()).resolves.toEqual({ ok: false, error: "Too many attempts. Try again in 60 seconds." });
    expect(mocks.runVerifiedLeadAllocation).not.toHaveBeenCalled();
  });
});
