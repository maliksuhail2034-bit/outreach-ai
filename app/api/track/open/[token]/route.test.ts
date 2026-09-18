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
import { signOpenTrackingToken, type OpenTrackingContext } from "@/lib/email/tracking-token";

const CONTEXT: OpenTrackingContext = {
  campaignId: "550e8400-e29b-41d4-a716-446655440000",
  campaignLeadId: "650e8400-e29b-41d4-a716-446655440001",
  leadId: "750e8400-e29b-41d4-a716-446655440002",
  mailboxId: "850e8400-e29b-41d4-a716-446655440003",
  sequenceStepId: "950e8400-e29b-41d4-a716-446655440004",
};

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

function request(token: string): Request {
  return new Request(`https://app.example.com/api/track/open/${token}`);
}

describe("GET /api/track/open/[token]", () => {
  beforeEach(() => {
    vi.stubEnv("TRACKING_TOKEN_SECRET", "test-secret-do-not-use-in-prod");
    recordEmailEvent.mockReset().mockResolvedValue({});
    createAdminClient.mockReset().mockReturnValue({ __fakeAdminClient: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a 1x1 gif image for a valid token and records an opened event", async () => {
    const token = signOpenTrackingToken(CONTEXT);
    const response = await GET(request(token), makeParams(token));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(34); // the static 1x1 transparent GIF is exactly 34 bytes
    expect(body[0]).toBe(0x47); // 'G' — GIF magic byte, confirms it's actually image bytes

    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(recordEmailEvent).toHaveBeenCalledWith(
      { __fakeAdminClient: true },
      {
        campaign_id: CONTEXT.campaignId,
        lead_id: CONTEXT.leadId,
        mailbox_id: CONTEXT.mailboxId,
        event_type: "opened",
        metadata: { sequenceStepId: CONTEXT.sequenceStepId },
      },
    );
  });

  it("sets cache-control headers so the pixel is never cached", async () => {
    const token = signOpenTrackingToken(CONTEXT);
    const response = await GET(request(token), makeParams(token));

    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(response.headers.get("Cache-Control")).toMatch(/no-cache/);
  });

  it("returns the pixel and records nothing for a token with a tampered signature", async () => {
    const token = signOpenTrackingToken(CONTEXT);
    const [payload, signature] = token.split(".");
    const flipped = signature[0] === "A" ? "B" : "A";
    const tampered = `${payload}.${flipped}${signature.slice(1)}`;

    const response = await GET(request(tampered), makeParams(tampered));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(recordEmailEvent).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns the pixel and records nothing for a garbage/malformed token", async () => {
    const response = await GET(request("not-a-real-token"), makeParams("not-a-real-token"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });

  it("returns the pixel and records nothing for an empty token", async () => {
    const response = await GET(request(""), makeParams(""));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    expect(recordEmailEvent).not.toHaveBeenCalled();
  });

  it("still returns a valid pixel response if recording the event throws", async () => {
    recordEmailEvent.mockRejectedValue(new Error("db exploded"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = signOpenTrackingToken(CONTEXT);

    const response = await GET(request(token), makeParams(token));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/gif");
    // The internal error is logged server-side only, never thrown back to
    // the requester as a 500 or reflected into the response body/headers.
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
