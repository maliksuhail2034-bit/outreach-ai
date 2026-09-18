import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOpenTrackingUrl, signOpenTrackingToken, verifyOpenTrackingToken, type OpenTrackingContext } from "./tracking-token";

const CONTEXT: OpenTrackingContext = {
  campaignId: "550e8400-e29b-41d4-a716-446655440000",
  campaignLeadId: "650e8400-e29b-41d4-a716-446655440001",
  leadId: "750e8400-e29b-41d4-a716-446655440002",
  mailboxId: "850e8400-e29b-41d4-a716-446655440003",
  sequenceStepId: "950e8400-e29b-41d4-a716-446655440004",
};

describe("signOpenTrackingToken / verifyOpenTrackingToken", () => {
  beforeEach(() => {
    vi.stubEnv("TRACKING_TOKEN_SECRET", "test-secret-do-not-use-in-prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips: verifying a freshly signed token returns the original context", () => {
    const token = signOpenTrackingToken(CONTEXT);
    expect(verifyOpenTrackingToken(token)).toEqual(CONTEXT);
  });

  it("produces a URL-safe token (no characters needing percent-encoding)", () => {
    const token = signOpenTrackingToken(CONTEXT);
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("rejects a token with a tampered signature", () => {
    const token = signOpenTrackingToken(CONTEXT);
    const [payload, signature] = token.split(".");
    const flipped = signature[0] === "A" ? "B" : "A";
    const tampered = `${payload}.${flipped}${signature.slice(1)}`;
    expect(verifyOpenTrackingToken(tampered)).toBeNull();
  });

  it("rejects a token whose payload was swapped for a different context, reusing the original signature", () => {
    const tokenA = signOpenTrackingToken(CONTEXT);
    const [, signatureA] = tokenA.split(".");
    const otherContext: OpenTrackingContext = { ...CONTEXT, mailboxId: "050e8400-e29b-41d4-a716-446655440099" };
    const forgedPayload = Buffer.from(
      JSON.stringify([
        otherContext.campaignId,
        otherContext.campaignLeadId,
        otherContext.leadId,
        otherContext.mailboxId,
        otherContext.sequenceStepId,
      ]),
      "utf8",
    ).toString("base64url");
    expect(verifyOpenTrackingToken(`${forgedPayload}.${signatureA}`)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyOpenTrackingToken("")).toBeNull();
    expect(verifyOpenTrackingToken("not-a-real-token")).toBeNull();
    expect(verifyOpenTrackingToken(".")).toBeNull();
  });

  it("rejects a well-formed but structurally wrong payload (wrong field count) without throwing", () => {
    const shortTuple = Buffer.from(JSON.stringify([CONTEXT.campaignId, CONTEXT.campaignLeadId]), "utf8").toString("base64url");
    const forged = `${shortTuple}.${"a".repeat(43)}`;
    expect(verifyOpenTrackingToken(forged)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signOpenTrackingToken(CONTEXT);
    vi.stubEnv("TRACKING_TOKEN_SECRET", "a-completely-different-secret");
    expect(verifyOpenTrackingToken(token)).toBeNull();
  });

  it("returns null (never throws) when the secret isn't configured at verify time", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TRACKING_TOKEN_SECRET", "");
    const token = "some.token";
    expect(() => verifyOpenTrackingToken(token)).not.toThrow();
    expect(verifyOpenTrackingToken(token)).toBeNull();
  });

  it("throws a clear error when the secret isn't configured at sign time", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("TRACKING_TOKEN_SECRET", "");
    expect(() => signOpenTrackingToken(CONTEXT)).toThrow(/TRACKING_TOKEN_SECRET/);
  });
});

describe("buildOpenTrackingUrl", () => {
  beforeEach(() => {
    vi.stubEnv("TRACKING_TOKEN_SECRET", "test-secret-do-not-use-in-prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds an absolute pixel URL containing a verifiable token", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const url = buildOpenTrackingUrl(CONTEXT);
    expect(url.startsWith("https://app.example.com/api/track/open/")).toBe(true);

    const token = url.split("/api/track/open/")[1];
    expect(verifyOpenTrackingToken(token)).toEqual(CONTEXT);
  });

  it("strips a trailing slash from the configured app URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    const url = buildOpenTrackingUrl(CONTEXT);
    expect(url.startsWith("https://app.example.com/api/track/open/")).toBe(true);
    expect(url).not.toContain("//api/track");
  });

  it("throws a clear error when NEXT_PUBLIC_APP_URL isn't configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(() => buildOpenTrackingUrl(CONTEXT)).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
