import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// Step conditions in the real worker pipeline (runSendWorker →
// processCampaignLead): an unmet condition skips the step without claiming
// a send attempt and schedules the next step from the last real send. The
// evaluation itself is covered in step-conditions.test.ts; claimSendAttempt
// stops the pipeline with a sentinel when a step is sent.
vi.mock("@/lib/db", () => ({
  claimDueSends: vi.fn(),
  claimSendAttempt: vi.fn(),
  consumeSendNow: vi.fn(),
  deferDueCampaignLeads: vi.fn(),
  getCampaignById: vi.fn(),
  getLeadById: vi.fn(),
  getMailboxCredentials: vi.fn(),
  getSendAttempt: vi.fn(),
  getSettings: vi.fn(),
  getSuppression: vi.fn(),
  listAttachmentsForStepScoped: vi.fn(),
  listHumanStepEngagement: vi.fn(),
  listSentAttemptsForCampaignLead: vi.fn(),
  listSequenceSteps: vi.fn(),
  listSequences: vi.fn(),
  recordSendFailure: vi.fn(),
  recordSendSuccess: vi.fn(),
  updateCampaignLead: vi.fn(),
  updateClaimedCampaignLead: vi.fn(),
}));
vi.mock("@/lib/billing/limits", () => ({ isWithinMonthlyEmailLimit: vi.fn() }));
vi.mock("./get-provider", () => ({ getEmailProvider: vi.fn() }));

import {
  claimDueSends,
  claimSendAttempt,
  getCampaignById,
  getLeadById,
  getMailboxCredentials,
  getSuppression,
  listHumanStepEngagement,
  listSentAttemptsForCampaignLead,
  listSequenceSteps,
  listSequences,
  updateClaimedCampaignLead,
} from "@/lib/db";
import { isWithinMonthlyEmailLimit } from "@/lib/billing/limits";
import { runSendWorker } from "./send-worker";

const supabase = {} as unknown as Client;
const ALL_WEEK_UTC = { days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], startHour: 0, endHour: 24, timezone: "UTC" };
const NOW = new Date("2026-11-10T12:00:00.000Z");
const STEP_ONE_SENT = "2026-11-07T09:00:00.000Z";
const REACHED_CLAIM = new Error("reached claimSendAttempt");

function step(id: string, order: number, dayDelay: number, condition = "always", conditionStepId: string | null = null) {
  return { id, sequence_id: "sequence-1", step_order: order, day_delay: dayDelay, condition, condition_step_id: conditionStepId, subject: "Hi", body: "Hello", created_at: "", updated_at: "" };
}

// Day 0: step 1. Day 3: step 2a to openers of step 1, step 2b to the rest.
const STEPS = [step("step-1", 0, 0), step("step-2a", 1, 3, "opened", "step-1"), step("step-2b", 2, 3, "not_opened", "step-1"), step("step-3", 3, 4)];

function makeLead(overrides: Partial<Tables<"campaign_leads">> = {}): Tables<"campaign_leads"> {
  return {
    id: "cl-1",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    current_step_id: "step-2a",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    enrolled_at: "2026-01-01T00:00:00Z",
    last_error: null,
    locked_until: null,
    next_send_at: "2026-11-10T09:00:00.000Z",
    send_now_step_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "test-unsubscribe-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  vi.mocked(getCampaignById).mockResolvedValue({ id: "campaign-1", user_id: "user-1", status: "active", sending_window: ALL_WEEK_UTC } as never);
  vi.mocked(getLeadById).mockResolvedValue({ id: "lead-1", email: "lead@example.com", timezone: null } as never);
  vi.mocked(getMailboxCredentials).mockResolvedValue({ id: "mailbox-1" } as never);
  vi.mocked(listSequences).mockResolvedValue([{ id: "sequence-1" }] as never);
  vi.mocked(listSequenceSteps).mockResolvedValue(STEPS as never);
  vi.mocked(getSuppression).mockResolvedValue(null as never);
  vi.mocked(isWithinMonthlyEmailLimit).mockResolvedValue(true);
  vi.mocked(listSentAttemptsForCampaignLead).mockResolvedValue([
    { sequence_step_id: "step-1", provider_message_id: "m1", resolved_at: STEP_ONE_SENT, claimed_at: STEP_ONE_SENT },
  ] as never);
  vi.mocked(listHumanStepEngagement).mockResolvedValue([]);
  vi.mocked(updateClaimedCampaignLead).mockResolvedValue({} as never);
  vi.mocked(claimSendAttempt).mockRejectedValue(REACHED_CLAIM);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("send worker: step conditions", () => {
  it("skips 'opened step 1' for a lead who didn't open it, moving to the next step timed from step 1's send", async () => {
    vi.mocked(claimDueSends).mockResolvedValue([makeLead()] as never);

    await expect(runSendWorker(supabase, 25, 1)).resolves.toMatchObject({ claimed: 1, skipped: 1, sent: 0 });

    expect(claimSendAttempt).not.toHaveBeenCalled();
    expect(updateClaimedCampaignLead).toHaveBeenCalledWith(
      supabase,
      "cl-1",
      {
        status: "active",
        current_step_id: "step-2b",
        // 3 days after step 1 was actually sent — the same day step 2a was planned for.
        next_send_at: "2026-11-10T09:00:00.000Z",
        locked_until: null,
      },
      "step-2a",
    );
  });

  it("sends 'opened step 1' to a lead a person opened it for", async () => {
    vi.mocked(claimDueSends).mockResolvedValue([makeLead()] as never);
    vi.mocked(listHumanStepEngagement).mockResolvedValue([{ eventType: "opened", sequenceStepId: "step-1" }]);

    await expect(runSendWorker(supabase, 25, 1)).resolves.toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(claimSendAttempt).toHaveBeenCalledWith(supabase, "cl-1", "step-2a");
    expect(updateClaimedCampaignLead).not.toHaveBeenCalled();
  });

  it("completes the lead when the skipped step was the last one", async () => {
    vi.mocked(listSequenceSteps).mockResolvedValue([step("step-1", 0, 0), step("step-2a", 1, 3, "clicked", "step-1")] as never);
    vi.mocked(claimDueSends).mockResolvedValue([makeLead()] as never);

    await runSendWorker(supabase, 25, 1);

    expect(updateClaimedCampaignLead).toHaveBeenCalledWith(
      supabase,
      "cl-1",
      { status: "completed", current_step_id: null, next_send_at: null, locked_until: null },
      "step-2a",
    );
  });

  it("never evaluates an 'always' step", async () => {
    vi.mocked(claimDueSends).mockResolvedValue([makeLead({ current_step_id: "step-3" })] as never);

    await runSendWorker(supabase, 25, 1);

    expect(listHumanStepEngagement).not.toHaveBeenCalled();
    expect(listSentAttemptsForCampaignLead).not.toHaveBeenCalled();
    expect(claimSendAttempt).toHaveBeenCalledWith(supabase, "cl-1", "step-3");
  });

  it("lets an explicit Send Now for the step override its condition", async () => {
    vi.mocked(claimDueSends).mockResolvedValue([makeLead({ send_now_step_id: "step-2a" })] as never);

    await runSendWorker(supabase, 25, 1);

    expect(listHumanStepEngagement).not.toHaveBeenCalled();
    expect(claimSendAttempt).toHaveBeenCalledWith(supabase, "cl-1", "step-2a");
  });
});
