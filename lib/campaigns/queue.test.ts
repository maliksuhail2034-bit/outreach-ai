import { describe, expect, it } from "vitest";
import { selectUpcomingSends } from "./queue";
import type { Tables } from "@/types/database.types";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function lead(overrides: Partial<Tables<"campaign_leads">>): Tables<"campaign_leads"> {
  return {
    id: "cl-1",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    status: "active",
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    enrolled_at: NOW.toISOString(),
    current_step_id: "step-1",
    next_send_at: null,
    last_error: null,
    locked_until: null,
    ...overrides,
  };
}

describe("selectUpcomingSends", () => {
  it("only includes active leads with a scheduled next_send_at", () => {
    const result = selectUpcomingSends(
      [
        lead({ id: "a", status: "active", next_send_at: "2026-08-05T13:00:00.000Z" }),
        lead({ id: "b", status: "completed", next_send_at: "2026-08-05T14:00:00.000Z" }),
        lead({ id: "c", status: "active", next_send_at: null }),
      ],
      20,
      NOW,
    );

    expect(result.map((r) => r.campaignLeadId)).toEqual(["a"]);
  });

  it("sorts by scheduled time ascending", () => {
    const result = selectUpcomingSends(
      [
        lead({ id: "later", status: "active", next_send_at: "2026-08-06T00:00:00.000Z" }),
        lead({ id: "sooner", status: "active", next_send_at: "2026-08-05T13:00:00.000Z" }),
      ],
      20,
      NOW,
    );

    expect(result.map((r) => r.campaignLeadId)).toEqual(["sooner", "later"]);
  });

  it("caps results at the given limit", () => {
    const leads = Array.from({ length: 5 }, (_, i) =>
      lead({ id: `lead-${i}`, status: "active", next_send_at: `2026-08-0${5 + i}T13:00:00.000Z` }),
    );
    expect(selectUpcomingSends(leads, 2, NOW)).toHaveLength(2);
  });

  it("marks a currently-locked row as 'sending' instead of 'scheduled'", () => {
    const result = selectUpcomingSends(
      [
        lead({
          id: "locked",
          status: "active",
          next_send_at: "2026-08-05T13:00:00.000Z",
          locked_until: "2026-08-05T12:10:00.000Z",
        }),
      ],
      20,
      NOW,
    );

    expect(result[0].status).toBe("sending");
  });

  it("treats an expired lock as merely 'scheduled'", () => {
    const result = selectUpcomingSends(
      [
        lead({
          id: "expired-lock",
          status: "active",
          next_send_at: "2026-08-05T13:00:00.000Z",
          locked_until: "2026-08-05T11:00:00.000Z",
        }),
      ],
      20,
      NOW,
    );

    expect(result[0].status).toBe("scheduled");
  });
});
