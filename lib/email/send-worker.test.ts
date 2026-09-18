import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import {
  processClaimedLeads,
  loadAttachmentsForSend,
  resolveThreadingHeaders,
  injectOpenTrackingPixel,
  type ProcessOutcome,
  type SendWorkerSummary,
} from "./send-worker";
import { EmailSendError } from "./provider";
import { verifyOpenTrackingToken, type OpenTrackingContext } from "./tracking-token";

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

// Batch 3 micro-fix: a configured attachment that can't be safely turned
// into a provider payload must abort the send (throw before provider.send()
// is ever called), not silently go out without it. loadAttachmentsForSend is
// awaited as the very first statement inside processCampaignLead's try block,
// directly before provider.send() — a thrown rejection here means the rest
// of that try block, including provider.send(), never runs (plain JS
// control flow, not something a mock needs to separately prove) and control
// passes straight to the existing catch/retry/recordSendFailure path,
// unchanged by this fix. See that catch block for the classification logic
// these EmailSendError("retry") throws feed into.
describe("loadAttachmentsForSend", () => {
  const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

  function makeAttachmentRow(overrides: Partial<Tables<"email_attachments">> = {}): Tables<"email_attachments"> {
    return {
      id: "attachment-1",
      user_id: "user-1",
      sequence_step_id: "step-1",
      file_name: "proposal.pdf",
      mime_type: "application/pdf",
      size_bytes: PDF_BYTES.byteLength,
      storage_path: "user-1/uuid-proposal.pdf",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  // Mirrors the fake-Client pattern already used across lib/db/*.test.ts
  // (e.g. lib/db/attachments.test.ts) — every query-builder method returns
  // the same chainable object, which resolves via `.then` however many
  // `.eq()`/`.order()` calls precede the await.
  function createAttachmentSendClient(options: {
    rows: Tables<"email_attachments">[];
    downloads?: Record<string, { data: Blob | null; error: { message: string } | null }>;
  }) {
    const chainable = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      then: (resolve: (value: { data: unknown; error: unknown }) => void) =>
        resolve({ data: options.rows, error: null }),
    };
    for (const method of ["select", "eq", "order"] as const) {
      chainable[method].mockReturnValue(chainable);
    }
    const from = vi.fn(() => chainable);

    const download = vi.fn((path: string) => {
      const result = options.downloads?.[path];
      return Promise.resolve(result ?? { data: null, error: { message: "Object not found" } });
    });
    const storage = { from: vi.fn(() => ({ download })) };

    const client = { from, storage } as unknown as Client;
    return { client, download };
  }

  it("returns no attachments and never touches Storage when the step has none configured", async () => {
    const { client, download } = createAttachmentSendClient({ rows: [] });

    const result = await loadAttachmentsForSend(client, "step-1", "user-1", {
      campaignLeadId: "cl-1",
      sequenceStepId: "step-1",
    });

    expect(result).toEqual([]);
    expect(download).not.toHaveBeenCalled();
  });

  it("returns the provider-ready payload when every configured attachment downloads and validates cleanly", async () => {
    const row = makeAttachmentRow();
    const { client } = createAttachmentSendClient({
      rows: [row],
      downloads: { [row.storage_path]: { data: new Blob([PDF_BYTES]), error: null } },
    });

    const result = await loadAttachmentsForSend(client, "step-1", "user-1", {
      campaignLeadId: "cl-1",
      sequenceStepId: "step-1",
    });

    expect(result).toEqual([
      { filename: "proposal.pdf", content: Buffer.from(PDF_BYTES), contentType: "application/pdf" },
    ]);
  });

  it("aborts the send (throws) when a configured attachment fails to download", async () => {
    const row = makeAttachmentRow();
    const { client } = createAttachmentSendClient({
      rows: [row],
      downloads: { [row.storage_path]: { data: null, error: { message: "network error" } } },
    });

    await expect(
      loadAttachmentsForSend(client, "step-1", "user-1", { campaignLeadId: "cl-1", sequenceStepId: "step-1" }),
    ).rejects.toThrow(EmailSendError);
  });

  it("aborts the send (throws) when a configured attachment is missing from storage (no data, no error)", async () => {
    const row = makeAttachmentRow();
    const { client } = createAttachmentSendClient({
      rows: [row],
      downloads: { [row.storage_path]: { data: null, error: null } },
    });

    await expect(
      loadAttachmentsForSend(client, "step-1", "user-1", { campaignLeadId: "cl-1", sequenceStepId: "step-1" }),
    ).rejects.toThrow(EmailSendError);
  });

  it("aborts the send (throws) when a configured attachment fails server-side re-validation", async () => {
    const row = makeAttachmentRow();
    const notActuallyAPdf = new TextEncoder().encode("not actually a pdf");
    const { client } = createAttachmentSendClient({
      rows: [row],
      downloads: { [row.storage_path]: { data: new Blob([notActuallyAPdf]), error: null } },
    });

    await expect(
      loadAttachmentsForSend(client, "step-1", "user-1", { campaignLeadId: "cl-1", sequenceStepId: "step-1" }),
    ).rejects.toThrow(EmailSendError);
  });

  it("classifies the abort as retryable, matching the existing retry/backoff path for other send failures", async () => {
    const row = makeAttachmentRow();
    const { client } = createAttachmentSendClient({
      rows: [row],
      downloads: { [row.storage_path]: { data: null, error: { message: "network error" } } },
    });

    try {
      await loadAttachmentsForSend(client, "step-1", "user-1", { campaignLeadId: "cl-1", sequenceStepId: "step-1" });
      expect.unreachable("expected loadAttachmentsForSend to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EmailSendError);
      expect((error as EmailSendError).outcome).toBe("retry");
    }
  });

  it("aborts the whole send when only some of several configured attachments fail — never a partial send", async () => {
    const good = makeAttachmentRow({ id: "good", storage_path: "user-1/uuid-good.pdf" });
    const bad = makeAttachmentRow({ id: "bad", storage_path: "user-1/uuid-bad.pdf" });
    const { client } = createAttachmentSendClient({
      rows: [good, bad],
      downloads: {
        [good.storage_path]: { data: new Blob([PDF_BYTES]), error: null },
        [bad.storage_path]: { data: null, error: { message: "network error" } },
      },
    });

    await expect(
      loadAttachmentsForSend(client, "step-1", "user-1", { campaignLeadId: "cl-1", sequenceStepId: "step-1" }),
    ).rejects.toThrow(EmailSendError);
  });
});

// Batch 7 (pre-launch checklist item #7): follow-up campaign emails now
// thread under the immediately preceding step's send, the same
// inReplyTo/references capability already proven by the warmup engine's
// auto-reply step (lib/warmup/warmup-worker.ts) — see resolveThreadingHeaders's
// own header comment in send-worker.ts for the full reasoning.
describe("resolveThreadingHeaders", () => {
  function makeStep(id: string, stepOrder: number): Tables<"sequence_steps"> {
    return {
      id,
      sequence_id: "sequence-1",
      step_order: stepOrder,
      day_delay: 0,
      subject: null,
      body: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  const stepOne = makeStep("step-1", 0);
  const stepTwo = makeStep("step-2", 1);
  const steps = [stepOne, stepTwo];

  function makeSendAttempt(overrides: Partial<Tables<"send_attempts">> = {}): Tables<"send_attempts"> {
    return {
      id: "attempt-1",
      campaign_lead_id: "cl-1",
      sequence_step_id: "step-1",
      status: "sent",
      attempt_count: 1,
      provider_message_id: "abc123@mail.example.com",
      last_error: null,
      claimed_at: "2026-01-01T00:00:00Z",
      resolved_at: "2026-01-01T00:00:01Z",
      resolved_manually: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:01Z",
      ...overrides,
    };
  }

  // Mirrors getSendAttempt's exact query shape (select -> eq -> eq ->
  // maybeSingle) — same fake-Client pattern as lib/db/warmup.test.ts.
  function createSendAttemptLookupClient(result: Tables<"send_attempts"> | null) {
    const chainable = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(() => Promise.resolve({ data: result, error: null })),
    };
    chainable.select.mockReturnValue(chainable);
    chainable.eq.mockReturnValue(chainable);
    const from = vi.fn(() => chainable);
    const client = { from } as unknown as Client;
    return { client, chainable };
  }

  it("returns no headers for a campaign lead's first email — there is no previous step", async () => {
    const { client, chainable } = createSendAttemptLookupClient(null);

    const result = await resolveThreadingHeaders(client, steps, stepOne, "cl-1");

    expect(result).toEqual({});
    // Never even queries send_attempts — nothing precedes the first step.
    expect(chainable.select).not.toHaveBeenCalled();
  });

  it("threads under the previous step's successful send", async () => {
    const previousAttempt = makeSendAttempt({ status: "sent", provider_message_id: "parent-msg-id@example.com" });
    const { client, chainable } = createSendAttemptLookupClient(previousAttempt);

    const result = await resolveThreadingHeaders(client, steps, stepTwo, "cl-1");

    expect(result).toEqual({
      inReplyTo: "parent-msg-id@example.com",
      references: ["parent-msg-id@example.com"],
    });
    // Looks up the PREVIOUS step (step-1), never the current one (step-2).
    expect(chainable.eq).toHaveBeenCalledWith("campaign_lead_id", "cl-1");
    expect(chainable.eq).toHaveBeenCalledWith("sequence_step_id", "step-1");
    expect(chainable.eq).not.toHaveBeenCalledWith("sequence_step_id", "step-2");
  });

  it("does not thread when the previous attempt failed — a failed attempt is never the parent", async () => {
    const previousAttempt = makeSendAttempt({ status: "failed", provider_message_id: null });
    const { client } = createSendAttemptLookupClient(previousAttempt);

    const result = await resolveThreadingHeaders(client, steps, stepTwo, "cl-1");

    expect(result).toEqual({});
  });

  it("does not thread when the previous attempt is still pending (an in-flight/unknown-outcome retry)", async () => {
    const previousAttempt = makeSendAttempt({ status: "pending", provider_message_id: null });
    const { client } = createSendAttemptLookupClient(previousAttempt);

    const result = await resolveThreadingHeaders(client, steps, stepTwo, "cl-1");

    expect(result).toEqual({});
  });

  it("does not invent a Message-ID when there is no previous attempt row at all", async () => {
    const { client } = createSendAttemptLookupClient(null);

    const result = await resolveThreadingHeaders(client, steps, stepTwo, "cl-1");

    expect(result).toEqual({});
  });

  it("a retry of the current step queries the previous step's row, never the current step's own (no self-reference)", async () => {
    // Even though the current step (step-2) itself might have its own
    // 'pending'/'failed' send_attempts row after a retry, resolveThreadingHeaders
    // never looks it up — only step-1 (the previous step) is queried, so a
    // retry of the current step can never become its own threading parent.
    const previousAttempt = makeSendAttempt({ status: "sent", provider_message_id: "parent-msg-id@example.com" });
    const { client, chainable } = createSendAttemptLookupClient(previousAttempt);

    await resolveThreadingHeaders(client, steps, stepTwo, "cl-1");

    expect(chainable.eq).not.toHaveBeenCalledWith("sequence_step_id", stepTwo.id);
  });
});

// Batch 9A: open-tracking pixel injection, pulled out of processCampaignLead
// for direct unit testing — same rationale as loadAttachmentsForSend/
// resolveThreadingHeaders above.
describe("injectOpenTrackingPixel", () => {
  const CONTEXT: OpenTrackingContext = {
    campaignId: "campaign-1",
    campaignLeadId: "cl-1",
    leadId: "lead-1",
    mailboxId: "mailbox-1",
    sequenceStepId: "step-1",
  };

  beforeEach(() => {
    vi.stubEnv("TRACKING_TOKEN_SECRET", "test-secret-do-not-use-in-prod");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appends a hidden 1x1 pixel <img> to the HTML body when tracking is enabled", () => {
    const html = "<p>Hello there</p>";
    const result = injectOpenTrackingPixel(html, true, CONTEXT);

    expect(result.startsWith(html)).toBe(true);
    expect(result).toContain('<img src="https://app.example.com/api/track/open/');
    expect(result).toContain('width="1" height="1"');
  });

  it("the injected pixel URL carries a token that verifies back to the exact send context", () => {
    const result = injectOpenTrackingPixel("<p>Body</p>", true, CONTEXT);
    const match = result.match(/src="https:\/\/app\.example\.com\/api\/track\/open\/([^"]+)"/);
    expect(match).not.toBeNull();

    const token = match![1];
    expect(verifyOpenTrackingToken(token)).toEqual(CONTEXT);
  });

  it("returns the HTML unchanged when tracking is disabled", () => {
    const html = "<p>Hello there</p>";
    const result = injectOpenTrackingPixel(html, false, CONTEXT);

    expect(result).toBe(html);
    expect(result).not.toContain("<img");
  });

  it("degrades to the HTML unchanged (never throws) when required tracking config is missing", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TRACKING_TOKEN_SECRET", "test-secret-do-not-use-in-prod");
    // NEXT_PUBLIC_APP_URL deliberately left unset — buildOpenTrackingUrl
    // throws in that case; injectOpenTrackingPixel must swallow it.
    const html = "<p>Hello there</p>";
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = injectOpenTrackingPixel(html, true, CONTEXT);

    expect(result).toBe(html);
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("never touches the plain-text body — injectOpenTrackingPixel only takes/returns an html string", () => {
    // Structural guarantee: the function signature has no text parameter,
    // so there is no code path by which it could append markup to a
    // plain-text body. This test documents that invariant explicitly.
    expect(injectOpenTrackingPixel.length).toBe(3);
  });
});
