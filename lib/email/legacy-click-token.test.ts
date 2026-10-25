import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getSendAttempt: vi.fn(),
  findCampaignLead: vi.fn(),
  findSequenceStepWithCampaign: vi.fn(),
  getLeadById: vi.fn(),
}));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ __fakeAdminClient: true }) }));

import { resolveLegacyClickToken } from "./legacy-click-token";
import { signClickTrackingToken, type ClickTrackingContext } from "./tracking-token";

const CAMPAIGN = "550e8400-e29b-41d4-a716-446655440000";
const CAMPAIGN_LEAD = "650e8400-e29b-41d4-a716-446655440001";
const LEAD = "750e8400-e29b-41d4-a716-446655440002";
const MAILBOX = "850e8400-e29b-41d4-a716-446655440003";
const STEP = "950e8400-e29b-41d4-a716-446655440004";
const OTHER = "a50e8400-e29b-41d4-a716-446655440005";

const CUTOFF = "2026-10-25T12:00:00Z";
const DESTINATION = "https://example.com/pricing?utm_source=email&utm_medium=cold";

const CONTEXT: ClickTrackingContext = {
  campaignId: CAMPAIGN,
  campaignLeadId: CAMPAIGN_LEAD,
  leadId: LEAD,
  mailboxId: MAILBOX,
  sequenceStepId: STEP,
  destinationUrl: DESTINATION,
};

// A token as the old deployment issued it: signed with a secret this
// deployment doesn't have.
function legacyToken(overrides: Partial<ClickTrackingContext> = {}): string {
  vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "the-lost-production-secret");
  const token = signClickTrackingToken({ ...CONTEXT, ...overrides });
  vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "the-new-production-secret");
  return token;
}

// Payload encoded by hand, for shapes signClickTrackingToken refuses to sign.
function rawToken(tuple: unknown): string {
  return `${Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url")}.forged-signature`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLICK_TRACKING_LEGACY_BEFORE", CUTOFF);
  db.getSendAttempt.mockResolvedValue({ status: "sent", created_at: "2026-10-01T09:00:00Z" });
  db.findCampaignLead.mockResolvedValue({ id: CAMPAIGN_LEAD, campaign_id: CAMPAIGN, lead_id: LEAD, mailbox_id: MAILBOX });
  db.findSequenceStepWithCampaign.mockResolvedValue({
    id: STEP,
    subject: "Hi {{first_name}}",
    body: `Hi {{first_name}}, see ${DESTINATION} or [our docs](https://example.com/docs/{{company}}).`,
    sequences: { campaign_id: CAMPAIGN },
  });
  db.getLeadById.mockResolvedValue({
    id: LEAD,
    email: "prospect@example.com",
    first_name: "Ada",
    last_name: null,
    company: "acme",
    title: null,
    custom_fields: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function expectNoDatabaseRead() {
  expect(db.getSendAttempt).not.toHaveBeenCalled();
  expect(db.findCampaignLead).not.toHaveBeenCalled();
}

describe("resolveLegacyClickToken — valid legacy links", () => {
  it("accepts a link the stored step really contains, for the enrollment it was sent to", async () => {
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toEqual(CONTEXT);
    expect(db.getSendAttempt).toHaveBeenCalledWith({ __fakeAdminClient: true }, CAMPAIGN_LEAD, STEP);
  });

  it("accepts a link whose URL was built from a merge tag, re-rendered for the same lead", async () => {
    const destinationUrl = "https://example.com/docs/acme";
    await expect(resolveLegacyClickToken(legacyToken({ destinationUrl }))).resolves.toMatchObject({ destinationUrl });
  });

  it("still redirects, but doesn't attribute the click, when the enrollment's mailbox changed", async () => {
    db.findCampaignLead.mockResolvedValue({ id: CAMPAIGN_LEAD, campaign_id: CAMPAIGN, lead_id: LEAD, mailbox_id: OTHER });
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toEqual({ ...CONTEXT, mailboxId: null });
  });
});

describe("resolveLegacyClickToken — switched off", () => {
  it("does nothing when CLICK_TRACKING_LEGACY_BEFORE is unset", async () => {
    vi.stubEnv("CLICK_TRACKING_LEGACY_BEFORE", "");
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
    expectNoDatabaseRead();
  });

  it("does nothing when CLICK_TRACKING_LEGACY_BEFORE isn't a date", async () => {
    vi.stubEnv("CLICK_TRACKING_LEGACY_BEFORE", "soon");
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
    expectNoDatabaseRead();
  });
});

describe("resolveLegacyClickToken — forged or modified links", () => {
  it("rejects a modified destination the step never contained", async () => {
    await expect(resolveLegacyClickToken(legacyToken({ destinationUrl: "https://attacker.example/" }))).resolves.toBeNull();
  });

  it("rejects a destination that only extends a real link", async () => {
    const destinationUrl = `${DESTINATION}&next=https://attacker.example/`;
    await expect(resolveLegacyClickToken(legacyToken({ destinationUrl }))).resolves.toBeNull();
  });

  it("rejects a destination that is only a prefix of a real link", async () => {
    await expect(resolveLegacyClickToken(legacyToken({ destinationUrl: "https://example.com/pricing" }))).resolves.toBeNull();
  });

  it("rejects the unsubscribe stand-in used while re-rendering", async () => {
    db.findSequenceStepWithCampaign.mockResolvedValue({
      id: STEP,
      subject: "",
      body: "Opt out: {{unsubscribe_link}}",
      sequences: { campaign_id: CAMPAIGN },
    });
    await expect(resolveLegacyClickToken(legacyToken({ destinationUrl: "https://unsubscribe.invalid/" }))).resolves.toBeNull();
  });

  it("rejects ids that were never sent together (no send attempt)", async () => {
    db.getSendAttempt.mockResolvedValue(null);
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
    expect(db.findCampaignLead).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"])("rejects a send attempt that is %s, not sent", async (status) => {
    db.getSendAttempt.mockResolvedValue({ status, created_at: "2026-10-01T09:00:00Z" });
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
  });

  it("rejects an email sent at or after the cutoff — its link was signed with the current secret", async () => {
    db.getSendAttempt.mockResolvedValue({ status: "sent", created_at: CUTOFF });
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
  });
});

describe("resolveLegacyClickToken — cross-campaign and mismatched ids", () => {
  it("rejects a campaign id the enrollment doesn't belong to", async () => {
    await expect(resolveLegacyClickToken(legacyToken({ campaignId: OTHER }))).resolves.toBeNull();
  });

  it("rejects another campaign's step paired with this campaign's enrollment", async () => {
    db.findSequenceStepWithCampaign.mockResolvedValue({
      id: STEP,
      subject: "",
      body: DESTINATION,
      sequences: { campaign_id: OTHER },
    });
    await expect(resolveLegacyClickToken(legacyToken({ campaignId: OTHER }))).resolves.toBeNull();
    expect(db.findSequenceStepWithCampaign).not.toHaveBeenCalled();
  });

  it("rejects a lead id that isn't the enrollment's lead", async () => {
    await expect(resolveLegacyClickToken(legacyToken({ leadId: OTHER }))).resolves.toBeNull();
    expect(db.getLeadById).not.toHaveBeenCalled();
  });

  it("rejects a step that belongs to another campaign's sequence", async () => {
    db.findSequenceStepWithCampaign.mockResolvedValue({
      id: STEP,
      subject: "",
      body: DESTINATION,
      sequences: { campaign_id: OTHER },
    });
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
    expect(db.getLeadById).not.toHaveBeenCalled();
  });
});

describe("resolveLegacyClickToken — missing records", () => {
  it("rejects when the enrollment is gone", async () => {
    db.findCampaignLead.mockResolvedValue(null);
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
  });

  it("rejects when the step is gone", async () => {
    db.findSequenceStepWithCampaign.mockResolvedValue(null);
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
  });

  it("rejects when the step was edited and no longer contains the link", async () => {
    db.findSequenceStepWithCampaign.mockResolvedValue({
      id: STEP,
      subject: "",
      body: "New copy, https://example.com/other",
      sequences: { campaign_id: CAMPAIGN },
    });
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
  });

  it("rejects, without throwing, when the lead can't be read", async () => {
    db.getLeadById.mockRejectedValue(new Error("JSON object requested, multiple (or no) rows returned"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
  });

  it("rejects, without throwing, on a database error", async () => {
    db.getSendAttempt.mockRejectedValue(new Error("connection reset"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(resolveLegacyClickToken(legacyToken())).resolves.toBeNull();
  });
});

describe("resolveLegacyClickToken — malformed tokens never reach the database", () => {
  const ids = [CAMPAIGN, CAMPAIGN_LEAD, LEAD, MAILBOX, STEP];

  it.each([
    ["no separator", "abcdef"],
    ["empty payload", ".signature"],
    ["not base64 JSON", "%%%.signature"],
    ["wrong arity", rawToken([...ids])],
    ["non-string field", rawToken([...ids.slice(0, 4), 5, DESTINATION])],
    ["non-UUID id", rawToken(["campaign", ...ids.slice(1), DESTINATION])],
    ["javascript: destination", rawToken([...ids, "javascript:alert(1)"])],
    ["data: destination", rawToken([...ids, "data:text/html,<script>alert(1)</script>"])],
    ["protocol-relative destination", rawToken([...ids, "//attacker.example/"])],
    ["control characters in destination", rawToken([...ids, "https://example.com/\r\nSet-Cookie: x=1"])],
    ["not a URL at all", rawToken([...ids, "not a url"])],
    ["oversized token", `${"a".repeat(9000)}.signature`],
  ])("rejects a token with %s", async (_label, token) => {
    await expect(resolveLegacyClickToken(token)).resolves.toBeNull();
    expectNoDatabaseRead();
  });
});
