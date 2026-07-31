import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUnsubscribeUrl, signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const CAMPAIGN_LEAD_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("signUnsubscribeToken / verifyUnsubscribeToken", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "test-secret-do-not-use-in-prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips: verifying a freshly signed token returns the original id", () => {
    const token = signUnsubscribeToken(CAMPAIGN_LEAD_ID);
    expect(verifyUnsubscribeToken(token)).toBe(CAMPAIGN_LEAD_ID);
  });

  it("produces a URL-safe token (no characters needing percent-encoding)", () => {
    const token = signUnsubscribeToken(CAMPAIGN_LEAD_ID);
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("rejects a token with a tampered signature", () => {
    const token = signUnsubscribeToken(CAMPAIGN_LEAD_ID);
    const [payload, signature] = token.split(".");
    const flipped = signature[0] === "A" ? "B" : "A";
    const tampered = `${payload}.${flipped}${signature.slice(1)}`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("rejects a token whose payload was swapped for a different id, reusing the original signature", () => {
    const tokenA = signUnsubscribeToken(CAMPAIGN_LEAD_ID);
    const [, signatureA] = tokenA.split(".");
    const otherId = "650e8400-e29b-41d4-a716-446655440099";
    const forgedPayload = Buffer.from(otherId, "utf8").toString("base64url");
    expect(verifyUnsubscribeToken(`${forgedPayload}.${signatureA}`)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("not-a-real-token")).toBeNull();
    expect(verifyUnsubscribeToken(".")).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signUnsubscribeToken(CAMPAIGN_LEAD_ID);
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "a-completely-different-secret");
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("throws a clear error when the secret isn't configured", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "");
    expect(() => signUnsubscribeToken(CAMPAIGN_LEAD_ID)).toThrow(/UNSUBSCRIBE_TOKEN_SECRET/);
  });
});

describe("buildUnsubscribeUrl", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "test-secret-do-not-use-in-prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds an absolute URL containing a verifiable token", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const url = buildUnsubscribeUrl(CAMPAIGN_LEAD_ID);
    expect(url.startsWith("https://app.example.com/unsubscribe/")).toBe(true);

    const token = url.split("/unsubscribe/")[1];
    expect(verifyUnsubscribeToken(token)).toBe(CAMPAIGN_LEAD_ID);
  });

  it("strips a trailing slash from the configured app URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    const url = buildUnsubscribeUrl(CAMPAIGN_LEAD_ID);
    expect(url.startsWith("https://app.example.com/unsubscribe/")).toBe(true);
    expect(url).not.toContain("//unsubscribe");
  });

  it("throws a clear error when NEXT_PUBLIC_APP_URL isn't configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(() => buildUnsubscribeUrl(CAMPAIGN_LEAD_ID)).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
