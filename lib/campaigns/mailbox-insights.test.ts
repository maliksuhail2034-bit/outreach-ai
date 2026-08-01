import { describe, expect, it } from "vitest";
import { buildCampaignMailboxInsights, type CampaignMailboxInsightsInput } from "./mailbox-insights";

const MAILBOX_A = { id: "mailbox-a", display_name: "Mailbox A", email: "a@example.com" };
const MAILBOX_B = { id: "mailbox-b", display_name: "Mailbox B", email: "b@example.com" };
const MAILBOX_C = { id: "mailbox-c", display_name: null, email: "c@example.com" };

function sentAttempts(campaignLeadId: string, count: number) {
  return Array.from({ length: count }, () => ({ campaign_lead_id: campaignLeadId, status: "sent" }));
}

function repliedEvents(mailboxId: string, count: number) {
  return Array.from({ length: count }, () => ({ mailbox_id: mailboxId, event_type: "replied" }));
}

function bouncedEvents(mailboxId: string, count: number) {
  return Array.from({ length: count }, () => ({ mailbox_id: mailboxId, event_type: "bounced" }));
}

describe("buildCampaignMailboxInsights", () => {
  it("returns no mailboxes or insights when nothing has sent yet", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: MAILBOX_A.id },
      campaignLeads: [{ id: "lead-1", mailbox_id: null }],
      sendAttempts: [],
      emailEvents: [],
      mailboxes: [MAILBOX_A],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.mailboxes).toEqual([]);
    expect(result.insights).toEqual([]);
  });

  it("resolves a lead's mailbox via its own override, falling back to the campaign default otherwise", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: MAILBOX_A.id },
      campaignLeads: [
        { id: "lead-1", mailbox_id: null }, // falls back to campaign default (A)
        { id: "lead-2", mailbox_id: MAILBOX_B.id }, // explicit override
      ],
      sendAttempts: [...sentAttempts("lead-1", 10), ...sentAttempts("lead-2", 10)],
      emailEvents: [...repliedEvents(MAILBOX_A.id, 1), ...repliedEvents(MAILBOX_B.id, 1)],
      mailboxes: [MAILBOX_A, MAILBOX_B],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.mailboxes.map((m) => m.mailboxId).sort()).toEqual([MAILBOX_A.id, MAILBOX_B.id].sort());
  });

  it("excludes mailboxes not referenced by this campaign's leads, even if passed in", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: MAILBOX_A.id },
      campaignLeads: [{ id: "lead-1", mailbox_id: MAILBOX_A.id }],
      sendAttempts: sentAttempts("lead-1", 10),
      emailEvents: [],
      mailboxes: [MAILBOX_A, MAILBOX_B, MAILBOX_C], // B and C aren't used by any lead here
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.mailboxes).toHaveLength(1);
    expect(result.mailboxes[0].mailboxId).toBe(MAILBOX_A.id);
  });

  it("excludes a mailbox with zero sends rather than fabricating a summary for it", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: null },
      campaignLeads: [
        { id: "lead-1", mailbox_id: MAILBOX_A.id },
        { id: "lead-2", mailbox_id: MAILBOX_B.id },
      ],
      sendAttempts: sentAttempts("lead-1", 10), // lead-2/mailbox B never actually sent
      emailEvents: [],
      mailboxes: [MAILBOX_A, MAILBOX_B],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.mailboxes.map((m) => m.mailboxId)).toEqual([MAILBOX_A.id]);
  });

  it("returns a single informational insight when only one mailbox has activity", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: MAILBOX_A.id },
      campaignLeads: [{ id: "lead-1", mailbox_id: MAILBOX_A.id }],
      sendAttempts: sentAttempts("lead-1", 10),
      emailEvents: [],
      mailboxes: [MAILBOX_A],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.insights).toEqual([expect.objectContaining({ key: "single_mailbox", tone: "info" })]);
  });

  it("identifies the best and weakest mailbox by reply rate", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: null },
      campaignLeads: [
        { id: "lead-1", mailbox_id: MAILBOX_A.id },
        { id: "lead-2", mailbox_id: MAILBOX_B.id },
      ],
      sendAttempts: [...sentAttempts("lead-1", 100), ...sentAttempts("lead-2", 100)],
      emailEvents: [...repliedEvents(MAILBOX_A.id, 20), ...repliedEvents(MAILBOX_B.id, 2)],
      mailboxes: [MAILBOX_A, MAILBOX_B],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.insights).toContainEqual(
      expect.objectContaining({ key: "best_mailbox", tone: "good" }),
    );
    const weakest = result.insights.find((insight) => insight.key === "weakest_mailbox");
    expect(weakest?.message).toContain("Mailbox B");
  });

  it("flags redistribute-volume when the weakest mailbox trails the best by a significant reply-rate gap", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: null },
      campaignLeads: [
        { id: "lead-1", mailbox_id: MAILBOX_A.id },
        { id: "lead-2", mailbox_id: MAILBOX_B.id },
      ],
      sendAttempts: [...sentAttempts("lead-1", 100), ...sentAttempts("lead-2", 100)],
      emailEvents: [...repliedEvents(MAILBOX_A.id, 20), ...repliedEvents(MAILBOX_B.id, 2)],
      mailboxes: [MAILBOX_A, MAILBOX_B],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.insights).toContainEqual(expect.objectContaining({ key: "redistribute_volume", tone: "warning" }));
  });

  it("flags the highest-bounce mailbox as a warning once it crosses the high-bounce cutoff", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: null },
      campaignLeads: [
        { id: "lead-1", mailbox_id: MAILBOX_A.id },
        { id: "lead-2", mailbox_id: MAILBOX_B.id },
      ],
      sendAttempts: [...sentAttempts("lead-1", 100), ...sentAttempts("lead-2", 100)],
      emailEvents: [
        ...repliedEvents(MAILBOX_A.id, 10),
        ...repliedEvents(MAILBOX_B.id, 10),
        ...bouncedEvents(MAILBOX_B.id, 8), // 8% bounce rate, above the 5% cutoff
      ],
      mailboxes: [MAILBOX_A, MAILBOX_B],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.insights).toContainEqual(
      expect.objectContaining({ key: "highest_bounce_mailbox", tone: "warning" }),
    );
  });

  it("reports all mailboxes healthy and consistent when reply rates are close and bounce rates are low", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: null },
      campaignLeads: [
        { id: "lead-1", mailbox_id: MAILBOX_A.id },
        { id: "lead-2", mailbox_id: MAILBOX_B.id },
      ],
      sendAttempts: [...sentAttempts("lead-1", 100), ...sentAttempts("lead-2", 100)],
      emailEvents: [...repliedEvents(MAILBOX_A.id, 10), ...repliedEvents(MAILBOX_B.id, 9)],
      mailboxes: [MAILBOX_A, MAILBOX_B],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.insights).toContainEqual(expect.objectContaining({ key: "all_healthy_consistent", tone: "good" }));
    expect(result.insights.some((insight) => insight.key === "redistribute_volume")).toBe(false);
  });

  it("falls back to a mailbox's email when it has no display name", () => {
    const input: CampaignMailboxInsightsInput = {
      campaign: { default_mailbox_id: MAILBOX_C.id },
      campaignLeads: [{ id: "lead-1", mailbox_id: MAILBOX_C.id }],
      sendAttempts: sentAttempts("lead-1", 5),
      emailEvents: [],
      mailboxes: [MAILBOX_C],
    };
    const result = buildCampaignMailboxInsights(input);
    expect(result.mailboxes[0].label).toBe("c@example.com");
  });
});
