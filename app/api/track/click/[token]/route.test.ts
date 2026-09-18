import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordEmailEvent = vi.fn();
vi.mock("@/lib/db", () => ({
  recordEmailEvent: (...args: unknown[]) => recordEmailEvent(...args),
}));

const createAdminClient = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (...args: unknown[]) => createAdminClient(...args),
}));

import { GET } from "./route";
import { signClickTrackingToken, type ClickTrackingContext } from "@/lib/email/tracking-token";

const CONTEXT: ClickTrackingContext = {
  campaignId: "550e8400-e29b-41d4-a716-446655440000",
  campaignLeadId: "650e8400-e29b-41d4-a716-446655440001",
  leadId: "750e8400-e29b-41d4-a716-446655440002",
  mailboxId: "850e8400-e29b-41d4-a716-446655440003",
  sequenceStepId: "950e8400-e29b-41d4-a716-446655440004",
  destinationUrl: "https://example.com/pricing?utm_source=email",
};

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

function request(token: string): Request {
  return new Request(`https://app.example.com/api/track/click/${token}`, { redirect: "manual" });
}

describe("GET /api/track/click/[token]", () => {
  beforeEach(() => {
    vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "test-click-secret-do-not-use-in-prod");
    recordEmailEvent.mockReset().mockResolvedValue({});
    createAdminClient.mockReset().mockReturnValue({ __fakeAdminClient: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to the original destination for a valid token and records a clicked event", async () => {
    const token = signClickTrackingToken(CONTEXT);
    const response = await GET(request(token), makeParams(token));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(CONTEXT.destinationUrl);

    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(recordEmailEvent).toHaveBeenCalledWith(
      { __fakeAdminClient: true },
      {
        campaign_id: CONTEXT.campaignId,
        lead_id: CONTEXT.leadId,
        mailbox_id: CONTEXT.mailboxId,
        event_type: "clicked",
        metadata: { sequenceStepId: CONTEXT.sequenceStepId, destinationUrl: CONTEXT.destinationUrl },
      },
    );
  });

  it("sets no-cache headers on the redirect response", async () => {
    const token = signClickTrackingToken(CONTEXT);
    const response = await GET(request(token), makeParams(token));

    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("does NOT redirect for a token with a tampered signature — returns a plain, non-redirect rejection instead", async () => {
    const token = signClickTrackingToken(CONTEXT);
    const [payload, signature] = token.split(".");
    const flipped = signature[0] === "A" ? "B" : "A";
    const tampered = `${payload}.${flipped}${signature.slice(1)}`;

    const response = await GET(request(tampered), makeParams(tampered));

    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    expect(recordEmailEvent).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does NOT redirect for a garbage/malformed token", async () => {
    const response = await GET(request("not-a-real-token"), makeParams("not-a-real-token"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });

  it("does NOT redirect for an empty token", async () => {
    const response = await GET(request(""), makeParams(""));

    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });

  it("the rejection response never leaks the original destination or internal error detail", async () => {
    const token = signClickTrackingToken(CONTEXT);
    const [payload, signature] = token.split(".");
    const tampered = `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

    const response = await GET(request(tampered), makeParams(tampered));
    const body = await response.text();

    expect(body).not.toContain(CONTEXT.destinationUrl);
    expect(body).not.toContain("example.com");
    expect(body.toLowerCase()).not.toContain("error");
  });

  it("still redirects correctly even if recording the click event throws", async () => {
    recordEmailEvent.mockRejectedValue(new Error("db exploded"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = signClickTrackingToken(CONTEXT);

    const response = await GET(request(token), makeParams(token));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(CONTEXT.destinationUrl);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
