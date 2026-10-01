import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import { processUnsubscribe } from "./unsubscribe";

// processUnsubscribe orchestrates lib/db helpers; their own queries
// (findCampaignLead, markCampaignLeadUnsubscribed, createSuppression's
// duplicate handling) are covered in lib/db's tests. Every function
// unsubscribe.ts imports from "@/lib/db" must be present here.
const db = vi.hoisted(() => ({
  createSuppression: vi.fn(),
  findCampaignLead: vi.fn(),
  getCampaignById: vi.fn(),
  getLeadById: vi.fn(),
  markCampaignLeadUnsubscribed: vi.fn(),
  recordEmailEvent: vi.fn(),
}));
vi.mock("@/lib/db", () => db);

const supabase = {} as unknown as Client;

const enrollment = { id: "cl-1", campaign_id: "campaign-1", lead_id: "lead-1", mailbox_id: "mailbox-1", status: "active" };
const RECIPIENT = { userId: "user-1", email: "prospect@example.com", campaignLeadId: "cl-1" };
const current = (recipient = RECIPIENT) => ({ kind: "recipient" as const, recipient });
const legacy = (campaignLeadId = "cl-1") => ({ kind: "legacy" as const, campaignLeadId });

function expectNothingWritten() {
  expect(db.createSuppression).not.toHaveBeenCalled();
  expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
  expect(db.recordEmailEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findCampaignLead.mockResolvedValue(enrollment);
  db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-1" });
  db.getLeadById.mockResolvedValue({ id: "lead-1", email: "prospect@example.com" });
  db.createSuppression.mockResolvedValue(undefined);
  db.markCampaignLeadUnsubscribed.mockResolvedValue(true);
  db.recordEmailEvent.mockResolvedValue({ id: "event-1" });
});

describe("processUnsubscribe — current tokens (the recipient is in the token)", () => {
  it("suppresses the address for its owner, stops the enrollment, and records the event", async () => {
    const result = await processUnsubscribe(supabase, current());

    expect(result).toEqual({ ok: true, email: "prospect@example.com" });
    // The same (user_id, email) pair the send worker checks before every
    // send — getSuppression(campaign.user_id, lead.email) — in any campaign.
    expect(db.createSuppression).toHaveBeenCalledWith(supabase, {
      user_id: "user-1",
      email: "prospect@example.com",
      reason: "unsubscribed",
      source_campaign_id: "campaign-1",
    });
    expect(db.markCampaignLeadUnsubscribed).toHaveBeenCalledWith(supabase, "cl-1");
    expect(db.recordEmailEvent).toHaveBeenCalledTimes(1);
    expect(db.recordEmailEvent).toHaveBeenCalledWith(supabase, {
      campaign_id: "campaign-1",
      lead_id: "lead-1",
      mailbox_id: "mailbox-1",
      event_type: "unsubscribed",
    });
  });

  it("writes the suppression before touching the enrollment", async () => {
    await processUnsubscribe(supabase, current());

    expect(db.createSuppression.mock.invocationCallOrder[0]).toBeLessThan(
      db.markCampaignLeadUnsubscribed.mock.invocationCallOrder[0],
    );
  });

  it("still suppresses the address after its enrollment was deleted", async () => {
    db.findCampaignLead.mockResolvedValue(null);

    const result = await processUnsubscribe(supabase, current());

    expect(result).toEqual({ ok: true, email: "prospect@example.com" });
    expect(db.createSuppression).toHaveBeenCalledWith(supabase, {
      user_id: "user-1",
      email: "prospect@example.com",
      reason: "unsubscribed",
      source_campaign_id: null,
    });
    expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
    expect(db.recordEmailEvent).not.toHaveBeenCalled();
  });

  it("still suppresses the address after its campaign or lead was deleted (enrollment gone with it)", async () => {
    db.findCampaignLead.mockResolvedValue(null);

    await processUnsubscribe(supabase, current());

    expect(db.getCampaignById).not.toHaveBeenCalled();
    expect(db.getLeadById).not.toHaveBeenCalled();
    expect(db.createSuppression).toHaveBeenCalledTimes(1);
  });

  it("only suppresses for the token's owner, never touching an enrollment that belongs to someone else", async () => {
    db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-2" });

    await processUnsubscribe(supabase, current());

    expect(db.createSuppression).toHaveBeenCalledWith(supabase, expect.objectContaining({ user_id: "user-1", source_campaign_id: null }));
    expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
    expect(db.recordEmailEvent).not.toHaveBeenCalled();
  });

  it("doesn't stop an enrollment whose lead now has a different address (an unrelated lead)", async () => {
    db.getLeadById.mockResolvedValue({ id: "lead-1", email: "someone-new@example.com" });

    await processUnsubscribe(supabase, current());

    expect(db.createSuppression).toHaveBeenCalledWith(supabase, expect.objectContaining({ email: "prospect@example.com" }));
    expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
  });

  it("is idempotent: a repeated click re-applies the suppression (duplicates ignored) and records no second event", async () => {
    await processUnsubscribe(supabase, current());
    db.markCampaignLeadUnsubscribed.mockResolvedValue(false);
    const second = await processUnsubscribe(supabase, current());

    expect(second).toEqual({ ok: true, email: "prospect@example.com" });
    expect(db.createSuppression).toHaveBeenCalledTimes(2);
    expect(db.recordEmailEvent).toHaveBeenCalledTimes(1);
  });

  it("keys the suppression by the address exactly as the send-time check reads it", async () => {
    // Lead addresses are lowercased when created/imported (see
    // app/(app)/leads/actions.ts and import-actions.ts), and the token carries
    // the lead's stored address, so the suppression matches getSuppression's
    // exact lookup for this lead and for any re-import of the same address.
    await processUnsubscribe(supabase, current({ ...RECIPIENT, email: "person@example.com" }));

    expect(db.createSuppression).toHaveBeenCalledWith(supabase, expect.objectContaining({ email: "person@example.com" }));
  });

  it("still suppresses the address when the enrollment can't be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.findCampaignLead.mockRejectedValue(new Error("connection reset"));

    expect(await processUnsubscribe(supabase, current())).toEqual({ ok: true, email: "prospect@example.com" });
    expect(db.createSuppression).toHaveBeenCalledWith(supabase, expect.objectContaining({ user_id: "user-1", source_campaign_id: null }));
    expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("prospect@example.com");
    log.mockRestore();
  });

  it("only ever records an unsubscribe — never a reply or any other event", async () => {
    await processUnsubscribe(supabase, current());

    expect(db.recordEmailEvent.mock.calls.map(([, values]) => values.event_type)).toEqual(["unsubscribed"]);
  });
});

describe("processUnsubscribe — legacy tokens (only the enrollment id)", () => {
  it("resolves the recipient from the enrollment and unsubscribes exactly as before", async () => {
    const result = await processUnsubscribe(supabase, legacy());

    expect(result).toEqual({ ok: true, email: "prospect@example.com" });
    expect(db.createSuppression).toHaveBeenCalledWith(supabase, {
      user_id: "user-1",
      email: "prospect@example.com",
      reason: "unsubscribed",
      source_campaign_id: "campaign-1",
    });
    expect(db.markCampaignLeadUnsubscribed).toHaveBeenCalledWith(supabase, "cl-1");
    expect(db.recordEmailEvent).toHaveBeenCalledWith(supabase, expect.objectContaining({ event_type: "unsubscribed" }));
  });

  it("returns a friendly error, writing nothing, when the enrollment no longer exists", async () => {
    db.findCampaignLead.mockResolvedValue(null);

    const result = await processUnsubscribe(supabase, legacy("does-not-exist"));

    expect(result).toEqual({ ok: false, error: "This unsubscribe link is no longer valid." });
    expectNothingWritten();
  });

  it("returns the same friendly error when the enrollment lookup fails", async () => {
    db.findCampaignLead.mockRejectedValue(new Error("connection reset"));

    expect(await processUnsubscribe(supabase, legacy())).toEqual({ ok: false, error: "This unsubscribe link is no longer valid." });
    expectNothingWritten();
  });
});
