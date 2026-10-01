import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";

// A step written in the rich-text composer, sent through the real
// runSendWorker -> processCampaignLead path (database layer and provider
// mocked): the worker's HTML/text are the canonical renderer's output — the
// same function the composer preview calls — with click tracking, the
// unsubscribe footer, the open pixel and attachments applied on top exactly
// as for a plain-text step.

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
}));
const send = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => db);
vi.mock("./get-provider", () => ({ getEmailProvider: () => ({ send }) }));
vi.mock("@/lib/billing/limits", () => ({ isWithinMonthlyEmailLimit: async () => true }));
vi.mock("@/lib/monitoring/error-tracking", () => ({ captureError: vi.fn() }));

import { runSendWorker } from "./send-worker";
import { renderEmailContent } from "./render-email";
import { buildUnsubscribeUrl, oneClickUnsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe-token";
import { verifyClickTrackingToken } from "./tracking-token";
import type { MergeTagLead } from "./merge-tags";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const download = vi.fn();
const supabase = { storage: { from: () => ({ download }) } } as unknown as Client;
const ALWAYS_OPEN = { days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], startHour: 0, endHour: 24, timezone: "UTC" };

// The recipient the worker builds its unsubscribe link for: the campaign's
// owner (user-1, below), LEAD's address and the claimed enrollment (cl-1).
const RECIPIENT = { userId: "user-1", email: "ada@example.test", campaignLeadId: "cl-1" };

const LEAD = {
  id: "lead-1",
  email: "ada@example.test",
  first_name: "Ada",
  last_name: "Lovelace",
  company: "**Engines** <Ltd>",
  title: null,
  custom_fields: null,
};

const FORMATTED_BODY = [
  "Hi {{first_name}},",
  "",
  "I noticed **{{company}}** is _growing fast_.",
  "Worth a [quick call](https://cal.example.com/ada?x=1&y=2)? Details: https://example.com/deck",
].join("\n");

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

function mergeLead(): MergeTagLead {
  return { ...LEAD, unsubscribeUrl: buildUnsubscribeUrl(RECIPIENT) };
}

async function sendOnce() {
  db.claimDueSends.mockResolvedValue([claimedLead()]);
  await runSendWorker(supabase, 1, 1);
  expect(send).toHaveBeenCalledTimes(1);
  return send.mock.calls[0][0] as {
    subject: string;
    html: string;
    text: string;
    attachments?: unknown[];
    listUnsubscribeUrl?: string;
  };
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
  useStepBody(FORMATTED_BODY);
});

describe("send worker — rich-text composer bodies", () => {
  it("P: sends exactly the canonical rendering the preview shows, plus only the footer", async () => {
    const payload = await sendOnce();
    const rendered = renderEmailContent("Hi {{first_name}}", FORMATTED_BODY, mergeLead());

    expect(payload.subject).toBe("Hi Ada");
    expect(payload.html.startsWith(rendered.html)).toBe(true);
    expect(payload.html.slice(rendered.html.length)).toMatch(/^<hr\/><p style="[^"]*">[^<]*<a href="[^"]+">Unsubscribe<\/a><\/p>$/);
    expect(payload.text.startsWith(rendered.text)).toBe(true);
  });

  it("Q/R: the sent HTML is formatted and escaped, the text is readable with formatting removed", async () => {
    const payload = await sendOnce();

    expect(payload.html).toContain("<p>Hi Ada,</p>");
    expect(payload.html).toContain("<strong>**Engines** &lt;Ltd&gt;</strong> is <em>growing fast</em>.");
    expect(payload.html).toContain(
      '<a href="https://cal.example.com/ada?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">quick call</a>',
    );
    expect(payload.html).toContain(
      '<a href="https://example.com/deck" target="_blank" rel="noopener noreferrer">https://example.com/deck</a>',
    );
    expect(payload.text.split("\n\n")[0]).toBe("Hi Ada,");
    expect(payload.text).toContain("I noticed **Engines** <Ltd> is growing fast.");
    expect(payload.text).toContain("Worth a quick call (https://cal.example.com/ada?x=1&y=2)? Details: https://example.com/deck");
  });

  it("S: click-tracks explicit and bare links (keeping their visible text) and adds the open pixel", async () => {
    db.getSettings.mockResolvedValue({ tracking_enabled: true, unsubscribe_text: null });
    const payload = await sendOnce();

    const hrefs = [...payload.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    const tracked = hrefs.filter((href) => href.startsWith("https://app.test/api/track/click/"));
    expect(hrefs.filter((href) => !tracked.includes(href))).toEqual([buildUnsubscribeUrl(RECIPIENT)]);
    expect(tracked).toHaveLength(2);
    expect(payload.html).toContain(">quick call</a>");
    expect(payload.html).toContain(">https://example.com/deck</a>");

    const destinations = tracked.map((href) => verifyClickTrackingToken(href.split("/").pop()!)?.destinationUrl);
    expect(destinations).toEqual(["https://cal.example.com/ada?x=1&y=2", "https://example.com/deck"]);

    expect(payload.html).toMatch(/<img src="https:\/\/app\.test\/[^"]+" width="1" height="1"/);
    // The footer's unsubscribe link is never tracked.
    expect(payload.html).toContain(`<a href="${buildUnsubscribeUrl(RECIPIENT)}">Unsubscribe</a>`);
  });

  it("M6: asks for List-Unsubscribe headers pointing at the one-click endpoint for the footer link's own token", async () => {
    const payload = await sendOnce();
    const unsubscribeUrl = buildUnsubscribeUrl(RECIPIENT);

    expect(payload.listUnsubscribeUrl).toBe(`${unsubscribeUrl}/one-click`);
    expect(payload.listUnsubscribeUrl).toBe(oneClickUnsubscribeUrl(unsubscribeUrl));
    expect(payload.listUnsubscribeUrl?.startsWith("https://")).toBe(true);
    const token = payload.listUnsubscribeUrl?.split("/").at(-2) ?? "";
    expect(token.startsWith("v2.")).toBe(true);
    expect(verifyUnsubscribeToken(token)).toEqual({ kind: "recipient", recipient: RECIPIENT });
  });

  it("T: appends the unsubscribe footer to a formatted body that has no unsubscribe link", async () => {
    const payload = await sendOnce();
    const unsubscribeUrl = buildUnsubscribeUrl(RECIPIENT);
    expect(payload.html).toContain(`<a href="${unsubscribeUrl}">Unsubscribe</a>`);
    expect(payload.text.endsWith(unsubscribeUrl)).toBe(true);
  });

  it("T: a composer [Unsubscribe]({{unsubscribe_link}}) link counts as the unsubscribe link, untracked", async () => {
    useStepBody("Thanks!\n\n[Unsubscribe here]({{unsubscribe_link}})");
    db.getSettings.mockResolvedValue({ tracking_enabled: true, unsubscribe_text: null });
    const payload = await sendOnce();
    const unsubscribeUrl = buildUnsubscribeUrl(RECIPIENT);

    expect(payload.html).toContain(`>Unsubscribe here</a>`);
    expect(payload.html).not.toContain("<hr/>");
    expect(payload.text).toBe(`Thanks!\n\nUnsubscribe here (${unsubscribeUrl})`);
    const unsubscribeHref = payload.html.match(/href="([^"]+)"[^>]*>Unsubscribe here/)?.[1];
    expect(unsubscribeHref?.replace(/&amp;/g, "&")).toBe(unsubscribeUrl);
  });

  it("U: sends a formatted body's attachments alongside it", async () => {
    db.listAttachmentsForStepScoped.mockResolvedValue([
      {
        id: "attachment-1",
        user_id: "user-1",
        sequence_step_id: "step-1",
        file_name: "proposal.pdf",
        mime_type: "application/pdf",
        size_bytes: PDF_BYTES.byteLength,
        storage_path: "user-1/proposal.pdf",
        created_at: "",
        updated_at: "",
      },
    ]);
    download.mockResolvedValue({ data: new Blob([PDF_BYTES]), error: null });

    const payload = await sendOnce();

    expect(payload.attachments).toEqual([
      { filename: "proposal.pdf", content: Buffer.from(PDF_BYTES), contentType: "application/pdf" },
    ]);
    expect(payload.html).toContain("<strong>");
  });

  it("resolves an alias variable written straight after a URL, in HTML and plain text", async () => {
    useStepBody("Your page: https://acme.com/{{ First Name }} — enjoy");
    const payload = await sendOnce();

    expect(payload.html.startsWith(
      '<p>Your page: <a href="https://acme.com/Ada" target="_blank" rel="noopener noreferrer">https://acme.com/Ada</a> — enjoy</p>',
    )).toBe(true);
    expect(payload.text.startsWith("Your page: https://acme.com/Ada — enjoy")).toBe(true);
  });

  it("V: a plain-text step still sends exactly as before", async () => {
    useStepBody("Hi {{first_name}},\n\nQuick question about {{company}}.\nhttps://example.com");
    const payload = await sendOnce();

    expect(payload.html.startsWith(
      '<p>Hi Ada,</p>\n<p>Quick question about **Engines** &lt;Ltd&gt;.<br>\n<a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>',
    )).toBe(true);
    expect(payload.text.startsWith("Hi Ada,\n\nQuick question about **Engines** <Ltd>.\nhttps://example.com")).toBe(true);
  });
});
