import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// Degraded-run alerting (reportDegradedSendRun): thresholds on their own, and
// through the real runSendWorker with the database layer mocked — same
// "mock the seam" approach as send-worker-status-race.test.ts.

const db = vi.hoisted(() => ({
  claimDueSends: vi.fn(),
  claimSendAttempt: vi.fn(),
  confirmSendAttemptEligible: vi.fn(),
  consumeSendNow: vi.fn(),
  deferDueCampaignLeads: vi.fn(),
  getCampaignById: vi.fn(),
  getLeadById: vi.fn(),
  getMailboxCredentials: vi.fn(),
  getSendAttempt: vi.fn(),
  getSettings: vi.fn(),
  getSuppression: vi.fn(),
  listAttachmentsForStepScoped: vi.fn(),
  listSequenceSteps: vi.fn(),
  listSequences: vi.fn(),
  recordSendFailure: vi.fn(),
  recordSendSuccess: vi.fn(),
  updateCampaignLead: vi.fn(),
  updateClaimedCampaignLead: vi.fn(),
}));
const captureError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => db);
vi.mock("./get-provider", () => ({ getEmailProvider: () => ({ send: vi.fn() }) }));
vi.mock("@/lib/billing/limits", () => ({ isWithinMonthlyEmailLimit: async () => true }));
vi.mock("@/lib/monitoring/error-tracking", () => ({ captureError }));

import { reportDegradedSendRun, runSendWorker, type SendWorkerSummary } from "./send-worker";

const supabase = {} as unknown as Client;

function summary(overrides: Partial<SendWorkerSummary>): SendWorkerSummary {
  return { claimed: 0, sent: 0, failed: 0, needsReview: 0, skipped: 0, ...overrides };
}

// A claimed row with no current step: processCampaignLead flags it
// needs_review before touching anything else.
function leadWithoutStep(): Tables<"campaign_leads"> {
  return {
    id: "cl-1",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    current_step_id: null,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    enrolled_at: "2026-01-01T00:00:00Z",
    last_error: null,
    locked_until: "2099-01-01T00:00:00Z",
    next_send_at: "2026-01-01T00:00:00Z",
    send_now_step_id: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  captureError.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("reportDegradedSendRun", () => {
  it("alerts when any lead needs review, with the run's counts", async () => {
    await reportDegradedSendRun(summary({ claimed: 5, sent: 4, needsReview: 1 }));

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith({
      job: "send-emails",
      message: "Degraded send run: 1 lead(s) need manual review",
      context: { claimed: 5, sent: 4, failed: 0, needsReview: 1 },
    });
  });

  it("alerts when more than half of the claimed sends failed", async () => {
    await reportDegradedSendRun(summary({ claimed: 5, sent: 2, failed: 3 }));

    expect(captureError).toHaveBeenCalledWith({
      job: "send-emails",
      message: "Degraded send run: high failure rate: 3/5 sends failed",
      context: { claimed: 5, sent: 2, failed: 3, needsReview: 0 },
    });
  });

  it("names both reasons in one alert when both apply", async () => {
    await reportDegradedSendRun(summary({ claimed: 3, failed: 2, needsReview: 1 }));

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][0].message).toBe(
      "Degraded send run: 1 lead(s) need manual review; high failure rate: 2/3 sends failed",
    );
  });

  it("does not alert when nothing was claimed", async () => {
    await reportDegradedSendRun(summary({}));
    expect(captureError).not.toHaveBeenCalled();
  });

  it("does not alert for a normal successful run", async () => {
    await reportDegradedSendRun(summary({ claimed: 4, sent: 3, skipped: 1 }));
    expect(captureError).not.toHaveBeenCalled();
  });

  it("does not alert at exactly a 50% failure rate", async () => {
    await reportDegradedSendRun(summary({ claimed: 4, sent: 2, failed: 2 }));
    expect(captureError).not.toHaveBeenCalled();
  });

  it("never throws, even if the alert itself fails", async () => {
    captureError.mockRejectedValue(new Error("webhook exploded"));

    await expect(reportDegradedSendRun(summary({ claimed: 1, needsReview: 1 }))).resolves.toBeUndefined();
  });
});

describe("runSendWorker degraded-run alerting", () => {
  it("does not alert when nothing is due", async () => {
    db.claimDueSends.mockResolvedValue([]);

    const result = await runSendWorker(supabase);

    expect(result).toEqual(summary({}));
    expect(captureError).not.toHaveBeenCalled();
  });

  it("alerts after a run that left a lead needing review, and returns the run's summary unchanged", async () => {
    db.claimDueSends.mockResolvedValue([leadWithoutStep()]);
    db.updateClaimedCampaignLead.mockResolvedValue(true);

    const result = await runSendWorker(supabase);

    expect(result).toEqual(summary({ claimed: 1, needsReview: 1 }));
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ job: "send-emails", context: { claimed: 1, sent: 0, failed: 0, needsReview: 1 } }),
    );
  });

  it("returns the same summary when the alert fails", async () => {
    db.claimDueSends.mockResolvedValue([leadWithoutStep()]);
    db.updateClaimedCampaignLead.mockResolvedValue(true);
    captureError.mockRejectedValue(new Error("webhook exploded"));

    await expect(runSendWorker(supabase)).resolves.toEqual(summary({ claimed: 1, needsReview: 1 }));
  });
});
