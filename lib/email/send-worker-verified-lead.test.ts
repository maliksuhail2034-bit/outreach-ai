import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// A lead delivered from the Polimatiq verified pool stores a placeholder
// address. The real runSendWorker path (database layer and provider mocked)
// must mail the real address resolved server-side, add the Art. 14 source
// notice, and never send to the placeholder or to a lead pulled from the pool.

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
  getDeliveredVerifiedLeadEmail: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => db);
vi.mock("./get-provider", () => ({ getEmailProvider: () => ({ send }) }));
vi.mock("@/lib/billing/limits", () => ({ isWithinMonthlyEmailLimit: async () => true }));
vi.mock("@/lib/monitoring/error-tracking", () => ({ captureError: vi.fn() }));

import { runSendWorker } from "./send-worker";
import { verifyUnsubscribeToken } from "./unsubscribe-token";
import { VERIFIED_LEAD_SOURCE_NOTICE } from "@/lib/verified-leads/contact";

const download = vi.fn();
const supabase = { storage: { from: () => ({ download }) } } as unknown as Client;
const ALWAYS_OPEN = { days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], startHour: 0, endHour: 24, timezone: "UTC" };

const PLACEHOLDER = "verified+vl-1@leads.polimatiq.invalid";
const REAL = "jane@acme.test";
const LEAD = {
  id: "lead-1",
  user_id: "user-1",
  email: PLACEHOLDER,
  display_email: "j••••@acme.test",
  verified_lead_id: "vl-1",
  first_name: "Jane",
  last_name: "Doe",
  company: "Acme",
  title: null,
  custom_fields: null,
};

const BODY = "Hi {{first_name}}, reach me at {{email}}.";

function claimedLead(): Tables<"campaign_leads"> {
  return {
    id: "cl-1",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    current_step_id: "step-1",
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

function useStepBody(body: string) {
  db.listSequenceSteps.mockResolvedValue([
    { id: "step-1", sequence_id: "seq-1", step_order: 0, day_delay: 0, subject: "Hi {{first_name}}", body, created_at: "", updated_at: "" },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "test-unsubscribe-secret");
  vi.stubEnv("TRACKING_TOKEN_SECRET", "test-open-secret");
  vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "test-click-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");

  db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-1", status: "active", sending_window: ALWAYS_OPEN });
  db.getLeadById.mockResolvedValue(LEAD);
  db.getMailboxCredentials.mockResolvedValue({ id: "mailbox-1", email: "sender@example.test", display_name: "Sender" });
  db.listSequences.mockResolvedValue([{ id: "seq-1" }]);
  db.getSuppression.mockResolvedValue(null);
  db.claimSendAttempt.mockResolvedValue({ id: "attempt-1", attempt_count: 1 });
  db.getSettings.mockResolvedValue({ tracking_enabled: false, unsubscribe_text: null });
  db.listAttachmentsForStepScoped.mockResolvedValue([]);
  db.confirmSendAttemptEligible.mockResolvedValue("ok");
  db.updateClaimedCampaignLead.mockResolvedValue(true);
  send.mockResolvedValue({ providerMessageId: "provider-msg-1" });
  useStepBody(BODY);
  db.getDeliveredVerifiedLeadEmail.mockResolvedValue({ email: REAL, status: "active" });
});

async function runOnce() {
  db.claimDueSends.mockResolvedValue([claimedLead()]);
  await runSendWorker(supabase, 1, 1);
}

describe("send worker — Polimatiq verified-pool leads", () => {
  it("mails the real address, never the placeholder, and adds the source notice", async () => {
    await runOnce();

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0] as { to: { email: string }; html: string; text: string; listUnsubscribeUrl: string };
    expect(payload.to.email).toBe(REAL);
    expect(JSON.stringify(payload)).not.toContain(PLACEHOLDER);
    expect(payload.text).toContain(`reach me at ${REAL}.`);
    expect(payload.text).toContain(VERIFIED_LEAD_SOURCE_NOTICE);
    expect(payload.html).toContain("Polimatiq from publicly available professional information");
    expect(db.getSuppression).toHaveBeenCalledWith(supabase, "user-1", REAL);
    expect(db.getDeliveredVerifiedLeadEmail).toHaveBeenCalledWith(supabase, expect.objectContaining({ id: "lead-1", verified_lead_id: "vl-1" }));
  });

  it("builds the unsubscribe link for the real address, so an unsubscribe pulls it from the pool", async () => {
    await runOnce();

    const { text } = send.mock.calls[0][0] as { text: string };
    const token = /\/unsubscribe\/([^\s]+)/.exec(text)?.[1];
    expect(token).toBeDefined();
    const verified = verifyUnsubscribeToken(decodeURIComponent(token!));
    expect(verified).toMatchObject({ kind: "recipient", recipient: { userId: "user-1", email: REAL, campaignLeadId: "cl-1" } });
  });

  it("doesn't send to a lead pulled from the pool, and stops the enrollment", async () => {
    db.getDeliveredVerifiedLeadEmail.mockResolvedValue({ email: REAL, status: "suppressed" });

    await runOnce();

    expect(send).not.toHaveBeenCalled();
    expect(db.claimSendAttempt).not.toHaveBeenCalled();
    expect(db.updateCampaignLead).toHaveBeenCalledWith(supabase, "cl-1", expect.objectContaining({ status: "unsubscribed" }));
  });

  it("flags for review instead of sending when the delivery record doesn't check out", async () => {
    db.getDeliveredVerifiedLeadEmail.mockResolvedValue(null);

    await runOnce();

    expect(send).not.toHaveBeenCalled();
    expect(db.updateClaimedCampaignLead).toHaveBeenCalledWith(
      supabase,
      "cl-1",
      expect.objectContaining({ status: "needs_review" }),
      "step-1",
    );
  });

  it("leaves the customer's own leads unchanged: no lookup, no source notice", async () => {
    db.getLeadById.mockResolvedValue({ ...LEAD, email: "own@acme.test", display_email: null, verified_lead_id: null });

    await runOnce();

    const payload = send.mock.calls[0][0] as { to: { email: string }; text: string };
    expect(payload.to.email).toBe("own@acme.test");
    expect(payload.text).not.toContain(VERIFIED_LEAD_SOURCE_NOTICE);
    expect(db.getDeliveredVerifiedLeadEmail).not.toHaveBeenCalled();
  });
});
