import { describe, expect, it } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import { processClaimedLeads, type ProcessOutcome, type SendWorkerSummary } from "./send-worker";

function makeLead(id: string, mailboxId: string | null): Tables<"campaign_leads"> {
  return {
    id,
    campaign_id: "campaign-1",
    lead_id: `lead-${id}`,
    mailbox_id: mailboxId,
    current_step_id: "step-1",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    enrolled_at: "2026-01-01T00:00:00Z",
    last_error: null,
    locked_until: null,
    next_send_at: "2026-01-01T00:00:00Z",
  };
}

function emptySummary(): SendWorkerSummary {
  return { claimed: 0, sent: 0, failed: 0, needsReview: 0, skipped: 0 };
}

const supabaseStub = {} as unknown as Client;

// Scalability Track, Phase B (item 12) — tests the new bounded-concurrency
// orchestration in isolation via the injected processOne parameter, rather
// than re-mocking the entire send pipeline processCampaignLead (unchanged
// by this item) already owns.
describe("processClaimedLeads", () => {
  it("processes every claimed lead exactly once and tallies the summary", async () => {
    const leads = [makeLead("a", "mailbox-1"), makeLead("b", "mailbox-2")];
    const processed: string[] = [];
    const processOne = async (_supabase: Client, lead: Tables<"campaign_leads">): Promise<ProcessOutcome> => {
      processed.push(lead.id);
      return "sent";
    };

    const summary = emptySummary();
    await processClaimedLeads(supabaseStub, leads, 1, Date.now(), summary, processOne);

    expect(processed).toEqual(["a", "b"]);
    expect(summary.sent).toBe(2);
  });

  it("with the default concurrency of 1, processes leads strictly in order, never overlapping", async () => {
    const leads = [makeLead("a", "mailbox-1"), makeLead("b", "mailbox-1"), makeLead("c", "mailbox-2")];
    const events: string[] = [];
    const processOne = async (_supabase: Client, lead: Tables<"campaign_leads">): Promise<ProcessOutcome> => {
      events.push(`start:${lead.id}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
      events.push(`end:${lead.id}`);
      return "sent";
    };

    const summary = emptySummary();
    await processClaimedLeads(supabaseStub, leads, 1, Date.now(), summary, processOne);

    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("never processes two leads for the same mailbox concurrently, even with concurrency > 1", async () => {
    const leads = [makeLead("a", "mailbox-1"), makeLead("b", "mailbox-1"), makeLead("c", "mailbox-1")];
    const activeSnapshots: number[] = [];
    let active = 0;
    const processOne = async (): Promise<ProcessOutcome> => {
      active += 1;
      activeSnapshots.push(active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return "sent";
    };

    const summary = emptySummary();
    await processClaimedLeads(supabaseStub, leads, 3, Date.now(), summary, processOne);

    // Every recorded concurrency snapshot must be 1 — three leads sharing
    // one mailbox, run with concurrency 3, must still never overlap.
    expect(activeSnapshots.every((count) => count === 1)).toBe(true);
    expect(summary.sent).toBe(3);
  });

  it("processes leads for different mailboxes concurrently when concurrency allows it", async () => {
    const leads = [makeLead("a", "mailbox-1"), makeLead("b", "mailbox-2")];
    let active = 0;
    let maxActive = 0;
    const processOne = async (): Promise<ProcessOutcome> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return "sent";
    };

    const summary = emptySummary();
    await processClaimedLeads(supabaseStub, leads, 2, Date.now(), summary, processOne);

    expect(maxActive).toBe(2);
  });

  it("treats leads with no mailbox_id as never conflicting with anything", async () => {
    const leads = [makeLead("a", null), makeLead("b", null), makeLead("c", null)];
    let active = 0;
    let maxActive = 0;
    const processOne = async (): Promise<ProcessOutcome> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return "sent";
    };

    const summary = emptySummary();
    await processClaimedLeads(supabaseStub, leads, 3, Date.now(), summary, processOne);

    expect(maxActive).toBe(3);
  });

  it("stops claiming new work once the time budget is exceeded, leaving the rest unprocessed", async () => {
    const leads = [makeLead("a", "mailbox-1"), makeLead("b", "mailbox-2"), makeLead("c", "mailbox-3")];
    const processed: string[] = [];
    const startedAt = Date.now() - 10 * 60_000; // 10 minutes ago — the budget is 4 minutes
    const processOne = async (_supabase: Client, lead: Tables<"campaign_leads">): Promise<ProcessOutcome> => {
      processed.push(lead.id);
      return "sent";
    };

    const summary = emptySummary();
    await processClaimedLeads(supabaseStub, leads, 1, startedAt, summary, processOne);

    expect(processed).toEqual([]);
    expect(summary.sent).toBe(0);
  });

  it("tallies each processOne outcome into the matching summary field", async () => {
    const leads = [
      makeLead("a", "mailbox-1"),
      makeLead("b", "mailbox-2"),
      makeLead("c", "mailbox-3"),
      makeLead("d", "mailbox-4"),
    ];
    const outcomes: ProcessOutcome[] = ["sent", "failed", "needsReview", "skipped"];
    let call = 0;
    const processOne = async (): Promise<ProcessOutcome> => outcomes[call++];

    const summary = emptySummary();
    await processClaimedLeads(supabaseStub, leads, 1, Date.now(), summary, processOne);

    expect(summary).toEqual({ claimed: 0, sent: 1, failed: 1, needsReview: 1, skipped: 1 });
  });

  it("propagates an unexpected processOne throw rather than swallowing it, matching the original loop's behavior", async () => {
    const leads = [makeLead("a", "mailbox-1"), makeLead("b", "mailbox-1")];
    const processOne = async (): Promise<ProcessOutcome> => {
      throw new Error("boom");
    };

    const summary = emptySummary();
    await expect(processClaimedLeads(supabaseStub, leads, 1, Date.now(), summary, processOne)).rejects.toThrow(
      "boom",
    );
  });
});
