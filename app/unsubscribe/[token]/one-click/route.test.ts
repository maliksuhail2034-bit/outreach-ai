import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real token verification and the real processUnsubscribe run here; only
// the database helpers and the admin client are replaced, so these tests
// cover the whole one-click path a mail provider's POST takes. Every
// function lib/email/unsubscribe.ts imports from "@/lib/db" must be present.
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

import { GET, POST } from "./route";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";

const SECRET = "test-unsubscribe-secret";
const RECIPIENT = { userId: "user-1", email: "prospect@example.com", campaignLeadId: "cl-1" };
const ENROLLMENT = { id: "cl-1", campaign_id: "campaign-1", lead_id: "lead-1", mailbox_id: "mailbox-1", status: "active" };
const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

function legacyToken(campaignLeadId: string) {
  const signature = createHmac("sha256", SECRET).update(campaignLeadId).digest("base64url");
  return `${Buffer.from(campaignLeadId, "utf8").toString("base64url")}.${signature}`;
}

function url(token: string) {
  return `https://app.example.test/unsubscribe/${token}/one-click`;
}

function params(token: string) {
  return { params: Promise.resolve({ token }) };
}

// What Gmail/Yahoo send (RFC 8058 §3.1): a form-encoded POST whose body is
// exactly the one-click marker.
function oneClickPost(token: string, body: BodyInit | null = ONE_CLICK_BODY, contentType: string | null = "application/x-www-form-urlencoded") {
  const headers = contentType ? { "Content-Type": contentType } : undefined;
  return POST(new Request(url(token), { method: "POST", headers, body }), params(token));
}

function expectNothingWritten() {
  expect(db.createSuppression).not.toHaveBeenCalled();
  expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
  expect(db.recordEmailEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", SECRET);
  createAdminClient.mockReturnValue(ADMIN_CLIENT);
  db.findCampaignLead.mockResolvedValue(ENROLLMENT);
  db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-1" });
  db.getLeadById.mockResolvedValue({ id: "lead-1", email: "prospect@example.com" });
  db.createSuppression.mockResolvedValue(undefined);
  db.markCampaignLeadUnsubscribed.mockResolvedValue(true);
  db.recordEmailEvent.mockResolvedValue({ id: "event-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /unsubscribe/[token]/one-click — RFC 8058 one-click", () => {
  it("unsubscribes the token's recipient: durable suppression, enrollment stopped, one event", async () => {
    const response = await oneClickPost(signUnsubscribeToken(RECIPIENT));

    expect(response.status).toBe(200);
    expect(db.createSuppression).toHaveBeenCalledWith(ADMIN_CLIENT, {
      user_id: "user-1",
      email: "prospect@example.com",
      reason: "unsubscribed",
      source_campaign_id: "campaign-1",
    });
    expect(db.markCampaignLeadUnsubscribed).toHaveBeenCalledWith(ADMIN_CLIENT, "cl-1");
    expect(db.recordEmailEvent).toHaveBeenCalledTimes(1);
    expect(db.recordEmailEvent).toHaveBeenCalledWith(ADMIN_CLIENT, expect.objectContaining({ event_type: "unsubscribed" }));
  });

  it("doesn't echo the recipient's address in the response", async () => {
    const response = await oneClickPost(signUnsubscribeToken(RECIPIENT));

    expect(await response.text()).not.toContain("prospect@example.com");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("accepts the marker sent as multipart/form-data too", async () => {
    const form = new FormData();
    form.set("List-Unsubscribe", "One-Click");

    const response = await oneClickPost(signUnsubscribeToken(RECIPIENT), form, null);

    expect(response.status).toBe(200);
    expect(db.createSuppression).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a repeated POST re-applies the same suppression and records no second event", async () => {
    const token = signUnsubscribeToken(RECIPIENT);
    await oneClickPost(token);
    // The enrollment is already 'unsubscribed' on the second request; the
    // duplicate suppression insert is absorbed by unique(user_id, email).
    db.markCampaignLeadUnsubscribed.mockResolvedValue(false);

    const second = await oneClickPost(token);

    expect(second.status).toBe(200);
    expect(db.createSuppression).toHaveBeenCalledTimes(2);
    expect(db.createSuppression.mock.calls[1]).toEqual(db.createSuppression.mock.calls[0]);
    expect(db.recordEmailEvent).toHaveBeenCalledTimes(1);
  });

  it("still suppresses after the enrollment (or its campaign/lead) was deleted (P.3 durability)", async () => {
    db.findCampaignLead.mockResolvedValue(null);

    const response = await oneClickPost(signUnsubscribeToken(RECIPIENT));

    expect(response.status).toBe(200);
    expect(db.createSuppression).toHaveBeenCalledWith(ADMIN_CLIENT, {
      user_id: "user-1",
      email: "prospect@example.com",
      reason: "unsubscribed",
      source_campaign_id: null,
    });
    expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
  });

  it("works for a legacy token while its enrollment exists", async () => {
    const response = await oneClickPost(legacyToken("cl-1"));

    expect(response.status).toBe(200);
    expect(db.createSuppression).toHaveBeenCalledWith(
      ADMIN_CLIENT,
      expect.objectContaining({ user_id: "user-1", email: "prospect@example.com" }),
    );
  });

  it("rejects a legacy token whose enrollment is gone, writing nothing", async () => {
    db.findCampaignLead.mockResolvedValue(null);

    const response = await oneClickPost(legacyToken("cl-1"));

    expect(response.status).toBe(400);
    expectNothingWritten();
  });
});

describe("POST /unsubscribe/[token]/one-click — identity comes only from the token", () => {
  it("ignores recipient identity supplied in the body", async () => {
    const body = new URLSearchParams({
      "List-Unsubscribe": "One-Click",
      user_id: "attacker-user",
      email: "victim@example.com",
      userId: "attacker-user",
      campaignLeadId: "someone-elses-enrollment",
    });

    const response = await oneClickPost(signUnsubscribeToken(RECIPIENT), body.toString());

    expect(response.status).toBe(200);
    expect(db.createSuppression).toHaveBeenCalledTimes(1);
    expect(db.createSuppression).toHaveBeenCalledWith(
      ADMIN_CLIENT,
      expect.objectContaining({ user_id: "user-1", email: "prospect@example.com" }),
    );
    expect(db.findCampaignLead).toHaveBeenCalledWith(ADMIN_CLIENT, "cl-1");
  });

  it("never suppresses for another user, nor touches an enrollment another user owns", async () => {
    db.getCampaignById.mockResolvedValue({ id: "campaign-1", user_id: "user-2" });

    await oneClickPost(signUnsubscribeToken(RECIPIENT));

    expect(db.createSuppression).toHaveBeenCalledTimes(1);
    expect(db.createSuppression).toHaveBeenCalledWith(ADMIN_CLIENT, expect.objectContaining({ user_id: "user-1" }));
    expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
    expect(db.recordEmailEvent).not.toHaveBeenCalled();
  });
});

describe("POST /unsubscribe/[token]/one-click — rejected safely, nothing written", () => {
  it.each([
    ["garbage", "not-a-token"],
    ["empty v2 payload", "v2."],
    ["truncated v2", "v2.AAAA"],
    ["legacy shape without a signature", "Y2wtMQ."],
  ])("malformed token (%s) → 400", async (_label, token) => {
    const response = await oneClickPost(token);

    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("tampered v2 token → 400", async () => {
    // A character inside the ciphertext, not the last one: base64url's final
    // character can carry only padding bits, so changing it may not change
    // the decoded bytes at all.
    const token = signUnsubscribeToken(RECIPIENT);
    const index = token.length - 10;
    const swapped = token[index] === "A" ? "B" : "A";

    const response = await oneClickPost(`${token.slice(0, index)}${swapped}${token.slice(index + 1)}`);

    expect(response.status).toBe(400);
    expectNothingWritten();
  });

  it("v2 token issued under a different secret → 400", async () => {
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "a-different-deployment-secret");
    const foreign = signUnsubscribeToken(RECIPIENT);
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", SECRET);

    const response = await oneClickPost(foreign);

    expect(response.status).toBe(400);
    expectNothingWritten();
  });

  it.each([
    ["no body", null, "application/x-www-form-urlencoded"],
    ["empty body", "", "application/x-www-form-urlencoded"],
    ["wrong marker value", "List-Unsubscribe=Yes", "application/x-www-form-urlencoded"],
    ["marker as JSON", JSON.stringify({ "List-Unsubscribe": "One-Click" }), "application/json"],
    ["marker as plain text", ONE_CLICK_BODY, "text/plain"],
  ])("valid token but not a one-click request (%s) → 400", async (_label, body, contentType) => {
    const response = await oneClickPost(signUnsubscribeToken(RECIPIENT), body, contentType);

    expect(response.status).toBe(400);
    expectNothingWritten();
  });
});

describe("GET /unsubscribe/[token]/one-click — never mutates", () => {
  it("redirects to the confirmation page for the same token without touching the database", async () => {
    const token = signUnsubscribeToken(RECIPIENT);

    const response = await GET(new Request(url(token)), params(token));

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(`https://app.example.test/unsubscribe/${token}`);
    expect(createAdminClient).not.toHaveBeenCalled();
    expectNothingWritten();
    expect(db.findCampaignLead).not.toHaveBeenCalled();
  });

  it("redirects an invalid token to the same page (which shows 'Link no longer valid'), still writing nothing", async () => {
    const response = await GET(new Request(url("not-a-token")), params("not-a-token"));

    expect(response.status).toBe(303);
    expectNothingWritten();
  });
});
