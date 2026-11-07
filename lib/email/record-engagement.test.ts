import { beforeEach, describe, expect, it, vi } from "vitest";

const getSendAttempt = vi.fn();
const hasHumanOpenForStep = vi.fn();
const recordEmailEvent = vi.fn();
vi.mock("@/lib/db", () => ({
  getSendAttempt: (...args: unknown[]) => getSendAttempt(...args),
  hasHumanOpenForStep: (...args: unknown[]) => hasHumanOpenForStep(...args),
  recordEmailEvent: (...args: unknown[]) => recordEmailEvent(...args),
}));

import type { Client } from "@/lib/db/shared";
import { recordEngagement, type EngagementContext } from "./record-engagement";

const SUPABASE = { __fake: true } as unknown as Client;
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const SENT_AT = new Date("2026-11-07T10:00:00Z");
const CONTEXT: EngagementContext = {
  campaignId: "550e8400-e29b-41d4-a716-446655440000",
  campaignLeadId: "650e8400-e29b-41d4-a716-446655440001",
  leadId: "750e8400-e29b-41d4-a716-446655440002",
  mailboxId: "850e8400-e29b-41d4-a716-446655440003",
  sequenceStepId: "950e8400-e29b-41d4-a716-446655440004",
};

function after(seconds: number): Date {
  return new Date(SENT_AT.getTime() + seconds * 1000);
}

describe("recordEngagement", () => {
  beforeEach(() => {
    getSendAttempt.mockReset().mockResolvedValue({ status: "sent", resolved_at: SENT_AT.toISOString() });
    hasHumanOpenForStep.mockReset().mockResolvedValue(true);
    recordEmailEvent.mockReset().mockResolvedValue({});
  });

  it("records a person's open with is_bot false and looks up the send by campaign lead and step", async () => {
    const result = await recordEngagement(SUPABASE, "opened", CONTEXT, CHROME, {}, after(600));

    expect(result).toEqual({ isBot: false });
    expect(getSendAttempt).toHaveBeenCalledWith(SUPABASE, CONTEXT.campaignLeadId, CONTEXT.sequenceStepId);
    expect(recordEmailEvent).toHaveBeenCalledTimes(1);
    expect(recordEmailEvent).toHaveBeenCalledWith(SUPABASE, {
      campaign_id: CONTEXT.campaignId,
      lead_id: CONTEXT.leadId,
      mailbox_id: CONTEXT.mailboxId,
      event_type: "opened",
      is_bot: false,
      metadata: { sequenceStepId: CONTEXT.sequenceStepId },
    });
  });

  it("records a scanner's click as a bot with the reason, and infers no open", async () => {
    const result = await recordEngagement(SUPABASE, "clicked", CONTEXT, CHROME, { destinationUrl: "https://x.test" }, after(3));

    expect(result).toEqual({ isBot: true });
    expect(recordEmailEvent).toHaveBeenCalledTimes(1);
    expect(recordEmailEvent.mock.calls[0][1]).toMatchObject({
      event_type: "clicked",
      is_bot: true,
      metadata: { sequenceStepId: CONTEXT.sequenceStepId, destinationUrl: "https://x.test", botReason: "within 20s of sending" },
    });
    expect(hasHumanOpenForStep).not.toHaveBeenCalled();
  });

  it("infers an open from a person's click when the step has no human open (images blocked)", async () => {
    hasHumanOpenForStep.mockResolvedValue(false);

    await recordEngagement(SUPABASE, "clicked", CONTEXT, CHROME, {}, after(600));

    expect(hasHumanOpenForStep).toHaveBeenCalledWith(SUPABASE, CONTEXT.campaignId, CONTEXT.leadId, CONTEXT.sequenceStepId);
    expect(recordEmailEvent).toHaveBeenCalledTimes(2);
    expect(recordEmailEvent.mock.calls[1][1]).toMatchObject({
      event_type: "opened",
      is_bot: false,
      metadata: { sequenceStepId: CONTEXT.sequenceStepId, inferredFromClick: true },
    });
  });

  it("does not infer an open when a person already opened the step", async () => {
    await recordEngagement(SUPABASE, "clicked", CONTEXT, CHROME, {}, after(600));
    expect(recordEmailEvent).toHaveBeenCalledTimes(1);
  });

  it("still records the event (without the timing rule) when the send lookup fails or the attempt isn't sent", async () => {
    getSendAttempt.mockRejectedValueOnce(new Error("db down"));
    expect(await recordEngagement(SUPABASE, "opened", CONTEXT, CHROME, {}, after(1))).toEqual({ isBot: false });

    getSendAttempt.mockResolvedValueOnce({ status: "pending", resolved_at: null });
    expect(await recordEngagement(SUPABASE, "opened", CONTEXT, CHROME, {}, after(1))).toEqual({ isBot: false });

    expect(recordEmailEvent).toHaveBeenCalledTimes(2);
  });
});
