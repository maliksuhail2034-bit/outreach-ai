import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The confirmation page's button posts here. As in one-click/route.test.ts,
// the real token verification and processUnsubscribe run; only the database
// helpers and the admin client are replaced.
const db = vi.hoisted(() => ({
  createSuppression: vi.fn(),
  findCampaignLead: vi.fn(),
  getCampaignById: vi.fn(),
  getLeadById: vi.fn(),
  markCampaignLeadUnsubscribed: vi.fn(),
  recordEmailEvent: vi.fn(),
}));
vi.mock("@/lib/db", () => db);

const ADMIN_CLIENT = { __fakeAdminClient: true };
const createAdminClient = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));

import { confirmUnsubscribeAction } from "./actions";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";

const SECRET = "test-unsubscribe-secret";
const RECIPIENT = { userId: "user-1", email: "prospect@example.com", campaignLeadId: "cl-1" };
const ENROLLMENT = { id: "cl-1", campaign_id: "campaign-1", lead_id: "lead-1", mailbox_id: "mailbox-1", status: "active" };

beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", SECRET);
  createAdminClient.mockReturnValue(ADMIN_CLIENT);
  db.findCampaignLead.mockResolvedValue(ENROLLMENT);
  db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-1" });
  db.getLeadById.mockResolvedValue({ id: "lead-1", email: "prospect@example.com" });
  db.markCampaignLeadUnsubscribed.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("confirmUnsubscribeAction", () => {
  it("suppresses the token's recipient for its owner on the admin client", async () => {
    const result = await confirmUnsubscribeAction(signUnsubscribeToken(RECIPIENT));

    expect(result).toEqual({ ok: true, email: "prospect@example.com" });
    expect(db.createSuppression).toHaveBeenCalledWith(ADMIN_CLIENT, {
      user_id: "user-1",
      email: "prospect@example.com",
      reason: "unsubscribed",
      source_campaign_id: "campaign-1",
    });
    expect(db.markCampaignLeadUnsubscribed).toHaveBeenCalledWith(ADMIN_CLIENT, "cl-1");
  });

  it("is idempotent: a second confirmation re-applies the suppression and records no second event", async () => {
    const token = signUnsubscribeToken(RECIPIENT);
    await confirmUnsubscribeAction(token);
    db.markCampaignLeadUnsubscribed.mockResolvedValue(false);

    const result = await confirmUnsubscribeAction(token);

    expect(result).toEqual({ ok: true, email: "prospect@example.com" });
    expect(db.createSuppression).toHaveBeenCalledTimes(2);
    expect(db.recordEmailEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered token without touching the database", async () => {
    const token = signUnsubscribeToken(RECIPIENT);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(await confirmUnsubscribeAction(tampered)).toEqual({ ok: false, error: "This unsubscribe link is invalid." });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(db.createSuppression).not.toHaveBeenCalled();
  });

  it("rejects a token signed with another secret (a link sent before the secret changed)", async () => {
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "the-lost-pre-cutover-secret");
    const oldToken = signUnsubscribeToken(RECIPIENT);
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", SECRET);

    expect(await confirmUnsubscribeAction(oldToken)).toEqual({ ok: false, error: "This unsubscribe link is invalid." });
    expect(db.createSuppression).not.toHaveBeenCalled();
  });

  it("can't be pointed at another recipient: the suppression comes only from the token", async () => {
    const other = signUnsubscribeToken({ userId: "user-2", email: "someone@example.com", campaignLeadId: "cl-2" });
    db.findCampaignLead.mockResolvedValue(null);

    await confirmUnsubscribeAction(other);

    expect(db.createSuppression).toHaveBeenCalledWith(ADMIN_CLIENT, expect.objectContaining({ user_id: "user-2", email: "someone@example.com" }));
    expect(db.createSuppression).not.toHaveBeenCalledWith(ADMIN_CLIENT, expect.objectContaining({ email: "prospect@example.com" }));
  });
});
