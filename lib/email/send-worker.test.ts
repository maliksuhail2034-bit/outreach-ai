import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import {
  enforceSendingWindow,
  processClaimedLeads,
  loadAttachmentsForSend,
  resolveThreadingHeaders,
  injectOpenTrackingPixel,
  rewriteClickTrackingLinks,
  type ProcessOutcome,
  type SendWorkerSummary,
} from "./send-worker";
import { EmailSendError } from "./provider";
import { verifyOpenTrackingToken, type OpenTrackingContext, verifyClickTrackingToken, type ClickTrackingContext } from "./tracking-token";
import { renderEmailContent } from "./render-email";
import type { MergeTagLead } from "./merge-tags";

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
    send_now_step_id: null,
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

// Batch 9B: click-link rewriting, pulled out of processCampaignLead for
// direct unit testing — same rationale as injectOpenTrackingPixel above.
describe("rewriteClickTrackingLinks", () => {
  const BASE_CONTEXT: Omit<ClickTrackingContext, "destinationUrl"> = {
    campaignId: "campaign-1",
    campaignLeadId: "cl-1",
    leadId: "lead-1",
    mailboxId: "mailbox-1",
    sequenceStepId: "step-1",
  };

  beforeEach(() => {
    vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "test-click-secret-do-not-use-in-prod");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rewrites an http(s) href to a signed click-tracking URL bound to that exact destination", () => {
    const html = '<p>Check out <a href="https://example.com/pricing" target="_blank" rel="noopener noreferrer">https://example.com/pricing</a> today.</p>';
    const result = rewriteClickTrackingLinks(html, true, [], BASE_CONTEXT);

    expect(result).toContain('href="https://app.example.com/api/track/click/');
    expect(result).not.toContain('href="https://example.com/pricing"');
    // The visible link text is left exactly as it was — only the href
    // attribute value is rewritten.
    expect(result).toContain(">https://example.com/pricing</a>");

    const match = result.match(/href="https:\/\/app\.example\.com\/api\/track\/click\/([^"]+)"/);
    expect(match).not.toBeNull();
    expect(verifyClickTrackingToken(match![1])).toEqual({ ...BASE_CONTEXT, destinationUrl: "https://example.com/pricing" });
  });

  it("rewrites multiple distinct links independently, each bound to its own destination", () => {
    const html =
      '<p><a href="https://a.example.com">A</a> and <a href="https://b.example.com/path?x=1">B</a></p>';
    const result = rewriteClickTrackingLinks(html, true, [], BASE_CONTEXT);

    const tokens = [...result.matchAll(/href="https:\/\/app\.example\.com\/api\/track\/click\/([^"]+)"/g)].map((m) => m[1]);
    expect(tokens).toHaveLength(2);
    const destinations = tokens.map((t) => verifyClickTrackingToken(t)?.destinationUrl).sort();
    expect(destinations).toEqual(["https://a.example.com", "https://b.example.com/path?x=1"]);
  });

  it("decodes an HTML-escaped ampersand in the href before signing, so the real destination (not a literal &amp;) is what gets tracked", () => {
    const html = '<a href="https://example.com/page?a=1&amp;b=2">link</a>';
    const result = rewriteClickTrackingLinks(html, true, [], BASE_CONTEXT);

    const match = result.match(/href="https:\/\/app\.example\.com\/api\/track\/click\/([^"]+)"/);
    expect(verifyClickTrackingToken(match![1])?.destinationUrl).toBe("https://example.com/page?a=1&b=2");
  });

  it("does not rewrite a link whose href is in excludeUrls (the unsubscribe link)", () => {
    const unsubscribeUrl = "https://app.example.com/unsubscribe/abc123";
    const html = `<p><a href="https://example.com/offer">Offer</a></p><hr/><p><a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
    const result = rewriteClickTrackingLinks(html, true, [unsubscribeUrl], BASE_CONTEXT);

    expect(result).toContain(`href="${unsubscribeUrl}"`);
    expect(result).toContain('href="https://app.example.com/api/track/click/');
  });

  it("does not rewrite mailto:, tel:, or #anchor hrefs", () => {
    const html =
      '<a href="mailto:someone@example.com">Email</a> <a href="tel:+15551234567">Call</a> <a href="#section">Jump</a>';
    const result = rewriteClickTrackingLinks(html, true, [], BASE_CONTEXT);

    expect(result).toBe(html);
  });

  it("returns the HTML unchanged when tracking is disabled", () => {
    const html = '<a href="https://example.com/offer">Offer</a>';
    const result = rewriteClickTrackingLinks(html, false, [], BASE_CONTEXT);

    expect(result).toBe(html);
  });

  it("leaves a link untracked (unchanged) rather than throwing when required tracking config is missing", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "test-click-secret-do-not-use-in-prod");
    // NEXT_PUBLIC_APP_URL deliberately left unset.
    const html = '<a href="https://example.com/offer">Offer</a>';
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = rewriteClickTrackingLinks(html, true, [], BASE_CONTEXT);

    expect(result).toBe(html);
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("never touches the plain-text body — rewriteClickTrackingLinks only takes/returns an html string", () => {
    expect(rewriteClickTrackingLinks.length).toBe(4);
  });

  it("leaves html with no links unchanged", () => {
    const html = "<p>No links here.</p>";
    expect(rewriteClickTrackingLinks(html, true, [], BASE_CONTEXT)).toBe(html);
  });

  // Regression test (security review follow-up): every other test in this
  // describe block hand-types its HTML fixtures — this is the one place
  // that proves the two real functions actually compose, so a future
  // change to either render-email.ts's output shape or this regex would be
  // caught here instead of silently breaking click tracking in production.
  it("composes correctly with the real renderer: renderEmailContent(...) -> rewriteClickTrackingLinks(...)", () => {
    const lead: MergeTagLead = { first_name: "Jane", email: "jane@example.com" };
    const rendered = renderEmailContent(
      "Subject",
      "Check out https://example.com/pricing and https://example.com/signup?a=1&b=2 today.",
      lead,
    );

    const result = rewriteClickTrackingLinks(rendered.html, true, [], BASE_CONTEXT);

    const tokens = [...result.matchAll(/href="https:\/\/app\.example\.com\/api\/track\/click\/([^"]+)"/g)].map((m) => m[1]);
    expect(tokens).toHaveLength(2);

    const destinations = tokens.map((t) => verifyClickTrackingToken(t)?.destinationUrl);
    expect(destinations).toContain("https://example.com/pricing");
    // The &amp; produced by renderEmailContent's own escaping is decoded
    // back to a real "&" in the signed destination, not left as a literal
    // entity.
    expect(destinations).toContain("https://example.com/signup?a=1&b=2");
  });
});

// Batch B: the final sending-window check. Exercises the real
// updateCampaignLead/deferDueCampaignLeads query builders against a
// recording fake client, so the assertions cover the actual rows/filters
// written — not just which helper was called.
describe("enforceSendingWindow", () => {
  type Call = { method: string; args: unknown[] };

  function createRecordingClient() {
    const statements: Call[][] = [];
    function from(table: string) {
      const calls: Call[] = [{ method: "from", args: [table] }];
      statements.push(calls);
      const chain: Record<string, unknown> = {};
      for (const method of ["update", "eq", "lte", "is", "or", "select", "not"]) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return chain;
        };
      }
      chain.single = async () => {
        calls.push({ method: "single", args: [] });
        return { data: makeLead("returned", "mailbox-1"), error: null };
      };
      // A matched row, so a conditional consume (consumeSendNow) succeeds.
      chain.then = (resolve: (value: { data: { id: string }[]; error: null }) => void) =>
        resolve({ data: [{ id: "cl-1" }], error: null });
      return chain;
    }
    return { client: { from } as unknown as Client, statements };
  }

  const DUBAI_SUN_TO_THU = {
    days: ["sun", "mon", "tue", "wed", "thu"],
    startHour: 9,
    endHour: 17,
    timezone: "Asia/Dubai",
  };
  const INSIDE = new Date("2026-09-23T06:00:00.000Z"); // Wed 10:00 Dubai
  const OUTSIDE = new Date("2026-09-25T05:06:00.000Z"); // Fri 09:06 Dubai (Fri disabled)
  const NEXT_OPENING = "2026-09-27T05:00:00.000Z"; // Sun 09:00 Dubai

  function updateValues(call: Call[]) {
    return call.find((c) => c.method === "update")?.args[0];
  }

  it("lets a normal due lead inside the window proceed without any write", async () => {
    const { client, statements } = createRecordingClient();
    const lead = makeLead("cl-1", "mailbox-1");

    expect(await enforceSendingWindow(client, lead, DUBAI_SUN_TO_THU, INSIDE)).toBe("send");
    expect(statements).toHaveLength(0);
  });

  it("defers the claimed lead outside the window: next opening, lease released, nothing else changed", async () => {
    const { client, statements } = createRecordingClient();
    const lead = makeLead("cl-1", "mailbox-1");

    expect(await enforceSendingWindow(client, lead, DUBAI_SUN_TO_THU, OUTSIDE)).toBe("deferred");

    expect(updateValues(statements[0])).toEqual({
      next_send_at: NEXT_OPENING,
      locked_until: null,
      send_now_step_id: null,
    });
    expect(statements[0]).toContainEqual({ method: "eq", args: ["id", "cl-1"] });
  });

  it("defers every other due, active, unleased, non-Send-Now lead of the same campaign to the same opening (D1b)", async () => {
    const { client, statements } = createRecordingClient();
    const lead = makeLead("cl-1", "mailbox-1");

    await enforceSendingWindow(client, lead, DUBAI_SUN_TO_THU, OUTSIDE);

    const bulk = statements[1];
    expect(updateValues(bulk)).toEqual({ next_send_at: NEXT_OPENING });
    expect(bulk).toEqual([
      { method: "from", args: ["campaign_leads"] },
      { method: "update", args: [{ next_send_at: NEXT_OPENING }] },
      { method: "eq", args: ["campaign_id", "campaign-1"] },
      { method: "eq", args: ["status", "active"] },
      { method: "lte", args: ["next_send_at", OUTSIDE.toISOString()] },
      { method: "is", args: ["send_now_step_id", null] },
      { method: "or", args: [`locked_until.is.null,locked_until.lt.${OUTSIDE.toISOString()}`] },
    ]);
  });

  it("lets an explicit Send Now for the current step send outside the window, consuming it first", async () => {
    const { client, statements } = createRecordingClient();
    const lead = { ...makeLead("cl-1", "mailbox-1"), send_now_step_id: "step-1" };

    expect(await enforceSendingWindow(client, lead, DUBAI_SUN_TO_THU, OUTSIDE)).toBe("send");

    // Consumed before returning "send" — i.e. before claimSendAttempt and the
    // provider send, so a failure's retry has no bypass left. Conditional on
    // the row still holding this exact bypass for this step, never by id alone.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toEqual([
      { method: "from", args: ["campaign_leads"] },
      { method: "update", args: [{ send_now_step_id: null }] },
      { method: "eq", args: ["id", "cl-1"] },
      { method: "eq", args: ["send_now_step_id", "step-1"] },
      { method: "eq", args: ["current_step_id", "step-1"] },
      { method: "select", args: ["id"] },
    ]);
  });

  it("also consumes a Send Now that happens to run inside the window", async () => {
    const { client, statements } = createRecordingClient();
    const lead = { ...makeLead("cl-1", "mailbox-1"), send_now_step_id: "step-1" };

    expect(await enforceSendingWindow(client, lead, DUBAI_SUN_TO_THU, INSIDE)).toBe("send");
    expect(updateValues(statements[0])).toEqual({ send_now_step_id: null });
  });

  it("ignores (and clears) a stale Send Now left from an earlier step", async () => {
    const { client, statements } = createRecordingClient();
    const lead = { ...makeLead("cl-1", "mailbox-1"), current_step_id: "step-2", send_now_step_id: "step-1" };

    expect(await enforceSendingWindow(client, lead, DUBAI_SUN_TO_THU, OUTSIDE)).toBe("deferred");
    expect(updateValues(statements[0])).toEqual({
      next_send_at: NEXT_OPENING,
      locked_until: null,
      send_now_step_id: null,
    });
  });

  it("clears a stale Send Now from an earlier step even when sending normally inside the window", async () => {
    const { client, statements } = createRecordingClient();
    const lead = { ...makeLead("cl-1", "mailbox-1"), current_step_id: "step-2", send_now_step_id: "step-1" };

    expect(await enforceSendingWindow(client, lead, DUBAI_SUN_TO_THU, INSIDE)).toBe("send");
    expect(statements).toHaveLength(1);
    expect(updateValues(statements[0])).toEqual({ send_now_step_id: null });
  });

  it("gives a retry after a failed Send Now no bypass (the bypass was consumed before the attempt)", async () => {
    const { client } = createRecordingClient();
    const sendNowLead = { ...makeLead("cl-1", "mailbox-1"), send_now_step_id: "step-1" };
    expect(await enforceSendingWindow(client, sendNowLead, DUBAI_SUN_TO_THU, OUTSIDE)).toBe("send");

    // The send then fails; record_send_failure('retry') reschedules the same
    // step without touching send_now_step_id, which the consume above set to
    // null. The retry is reclaimed outside the window:
    const retryLead = { ...sendNowLead, send_now_step_id: null };
    expect(await enforceSendingWindow(client, retryLead, DUBAI_SUN_TO_THU, OUTSIDE)).toBe("deferred");
  });
});
