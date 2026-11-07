import { describe, expect, it } from "vitest";
import type { Tables } from "@/types/database.types";
import { buildLeadActivity } from "./activity";

function event(overrides: Partial<Tables<"email_events">>): Tables<"email_events"> {
  return {
    id: "e",
    campaign_id: "c-1",
    lead_id: "lead-1",
    mailbox_id: null,
    event_type: "opened",
    is_bot: false,
    metadata: {},
    provider_message_id: null,
    created_at: "2026-11-07T10:00:00Z",
    ...overrides,
  } as Tables<"email_events">;
}

const CAMPAIGNS = new Map([["c-1", "Q4 outbound"]]);
const STEPS = new Map([
  ["s-1", 1],
  ["s-2", 2],
]);

describe("buildLeadActivity", () => {
  it("labels engagement with its campaign, step and destination, newest first", () => {
    const activity = buildLeadActivity({
      events: [
        event({ id: "o", metadata: { sequenceStepId: "s-2" }, created_at: "2026-11-07T11:00:00Z" }),
        event({
          id: "k",
          event_type: "clicked",
          metadata: { sequenceStepId: "s-1", destinationUrl: "https://acme.test/pricing" },
          created_at: "2026-11-07T12:00:00Z",
        }),
      ],
      sends: [{ id: "a", campaignId: "c-1", stepId: "s-1", sentAt: "2026-11-07T09:00:00Z" }],
      campaignNameById: CAMPAIGNS,
      stepNumberById: STEPS,
    });

    expect(activity.entries.map(({ id, label, detail }) => ({ id, label, detail }))).toEqual([
      { id: "k", label: "Clicked", detail: "Q4 outbound · Step 1 · https://acme.test/pricing" },
      { id: "o", label: "Opened", detail: "Q4 outbound · Step 2" },
      { id: "a", label: "Sent", detail: "Q4 outbound · Step 1" },
    ]);
    expect(activity.counts).toEqual({ sent: 1, opened: 1, clicked: 1, replied: 0 });
  });

  it("hides and counts scanner events, and takes sends from the send log only", () => {
    const activity = buildLeadActivity({
      events: [event({ id: "bot", is_bot: true }), event({ id: "sent", event_type: "sent" }), event({ id: "r", event_type: "replied" })],
      sends: [],
      campaignNameById: CAMPAIGNS,
      stepNumberById: STEPS,
    });

    expect(activity.entries.map((entry) => entry.id)).toEqual(["r"]);
    expect(activity.botEvents).toBe(1);
    expect(activity.counts).toEqual({ sent: 0, opened: 0, clicked: 0, replied: 1 });
  });

  it("explains an open inferred from a click, and a campaign since deleted", () => {
    const activity = buildLeadActivity({
      events: [event({ campaign_id: "gone", metadata: { inferredFromClick: true } })],
      sends: [],
      campaignNameById: CAMPAIGNS,
      stepNumberById: STEPS,
    });
    expect(activity.entries[0].detail).toBe("A deleted campaign · Counted from a click (images were blocked)");
  });
});
