import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUnsubscribeUrl, signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const SECRET = "test-secret-do-not-use-in-prod";
const CAMPAIGN_LEAD_ID = "550e8400-e29b-41d4-a716-446655440000";
const RECIPIENT = { userId: "user-1", email: "prospect@example.com", campaignLeadId: CAMPAIGN_LEAD_ID };

// Exactly what the previous signUnsubscribeToken produced, reimplemented
// here independently, so these tests prove a link already sent in an email
// still verifies — not merely that the code agrees with itself.
function legacyToken(campaignLeadId: string, secret = SECRET) {
  const signature = createHmac("sha256", secret).update(campaignLeadId).digest("base64url");
  return `${Buffer.from(campaignLeadId, "utf8").toString("base64url")}.${signature}`;
}

// Flips one character of the token body, keeping it valid base64url.
function tamper(token: string, index: number) {
  const flipped = token[index] === "A" ? "B" : "A";
  return `${token.slice(0, index)}${flipped}${token.slice(index + 1)}`;
}

beforeEach(() => {
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signUnsubscribeToken / verifyUnsubscribeToken — current tokens", () => {
  it("round-trips the recipient: owner, email and enrollment", () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(RECIPIENT))).toEqual({ kind: "recipient", recipient: RECIPIENT });
  });

  it("produces a URL-safe token (no characters needing percent-encoding)", () => {
    expect(signUnsubscribeToken(RECIPIENT)).toMatch(/^v2\.[A-Za-z0-9_-]+$/);
  });

  it("doesn't expose the email address or ids in the link", () => {
    const token = signUnsubscribeToken(RECIPIENT);
    for (const value of [RECIPIENT.email, RECIPIENT.userId, RECIPIENT.campaignLeadId]) {
      expect(token).not.toContain(value);
      expect(token).not.toContain(Buffer.from(value).toString("base64url"));
    }
    expect(Buffer.from(token.slice(3), "base64url").toString("latin1")).not.toContain("example.com");
  });

  it("is the same on every send to the same recipient, and different for any other recipient", () => {
    expect(signUnsubscribeToken(RECIPIENT)).toBe(signUnsubscribeToken({ ...RECIPIENT }));
    expect(signUnsubscribeToken({ ...RECIPIENT, userId: "user-2" })).not.toBe(signUnsubscribeToken(RECIPIENT));
    expect(signUnsubscribeToken({ ...RECIPIENT, email: "other@example.com" })).not.toBe(signUnsubscribeToken(RECIPIENT));
    expect(signUnsubscribeToken({ ...RECIPIENT, campaignLeadId: "cl-2" })).not.toBe(signUnsubscribeToken(RECIPIENT));
  });

  it("rejects a token with any part tampered: IV, auth tag or ciphertext", () => {
    const token = signUnsubscribeToken(RECIPIENT);
    // "v2." is 3 characters; 12-byte IV = 16 chars, 16-byte tag ≈ 22 chars.
    for (const index of [3, 10, 20, 30, 45, token.length - 2]) {
      expect(verifyUnsubscribeToken(tamper(token, index))).toBeNull();
    }
  });

  it("rejects a token issued with a different secret", () => {
    const token = signUnsubscribeToken(RECIPIENT);
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "a-completely-different-secret");
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("rejects truncated or garbage current-format input without throwing", () => {
    const token = signUnsubscribeToken(RECIPIENT);
    expect(verifyUnsubscribeToken("v2.")).toBeNull();
    expect(verifyUnsubscribeToken("v2.AAAA")).toBeNull();
    expect(verifyUnsubscribeToken(token.slice(0, 40))).toBeNull();
    expect(verifyUnsubscribeToken(`v2.${"A".repeat(80)}`)).toBeNull();
    expect(verifyUnsubscribeToken("v2.not base64!")).toBeNull();
  });

  it("throws a clear error when the secret isn't configured", () => {
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "");
    expect(() => signUnsubscribeToken(RECIPIENT)).toThrow(/UNSUBSCRIBE_TOKEN_SECRET/);
  });
});

describe("verifyUnsubscribeToken — legacy tokens already sent in emails", () => {
  it("still verifies, returning the enrollment id", () => {
    expect(verifyUnsubscribeToken(legacyToken(CAMPAIGN_LEAD_ID))).toEqual({ kind: "legacy", campaignLeadId: CAMPAIGN_LEAD_ID });
  });

  it("rejects a token with a tampered signature", () => {
    const [payload, signature] = legacyToken(CAMPAIGN_LEAD_ID).split(".");
    const flipped = signature[0] === "A" ? "B" : "A";
    expect(verifyUnsubscribeToken(`${payload}.${flipped}${signature.slice(1)}`)).toBeNull();
  });

  it("rejects a token whose payload was swapped for a different id, reusing the original signature", () => {
    const [, signatureA] = legacyToken(CAMPAIGN_LEAD_ID).split(".");
    const forgedPayload = Buffer.from("650e8400-e29b-41d4-a716-446655440099", "utf8").toString("base64url");
    expect(verifyUnsubscribeToken(`${forgedPayload}.${signatureA}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    expect(verifyUnsubscribeToken(legacyToken(CAMPAIGN_LEAD_ID, "a-completely-different-secret"))).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("not-a-real-token")).toBeNull();
    expect(verifyUnsubscribeToken(".")).toBeNull();
  });
});

describe("buildUnsubscribeUrl", () => {
  it("builds an absolute URL containing a verifiable current token", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const url = buildUnsubscribeUrl(RECIPIENT);
    expect(url.startsWith("https://app.example.com/unsubscribe/v2.")).toBe(true);

    const token = url.split("/unsubscribe/")[1];
    expect(verifyUnsubscribeToken(token)).toEqual({ kind: "recipient", recipient: RECIPIENT });
  });

  it("strips a trailing slash from the configured app URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    const url = buildUnsubscribeUrl(RECIPIENT);
    expect(url.startsWith("https://app.example.com/unsubscribe/")).toBe(true);
    expect(url).not.toContain("//unsubscribe");
  });

  it("throws a clear error when NEXT_PUBLIC_APP_URL isn't configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(() => buildUnsubscribeUrl(RECIPIENT)).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
