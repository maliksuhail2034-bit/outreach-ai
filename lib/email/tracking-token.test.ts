import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import {
  buildOpenTrackingUrl,
  signOpenTrackingToken,
  verifyOpenTrackingToken,
  type OpenTrackingContext,
  buildClickTrackingUrl,
  signClickTrackingToken,
  verifyClickTrackingToken,
  type ClickTrackingContext,
} from "./tracking-token";

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

// Batch 9B
const CLICK_CONTEXT: ClickTrackingContext = {
  campaignId: "550e8400-e29b-41d4-a716-446655440000",
  campaignLeadId: "650e8400-e29b-41d4-a716-446655440001",
  leadId: "750e8400-e29b-41d4-a716-446655440002",
  mailboxId: "850e8400-e29b-41d4-a716-446655440003",
  sequenceStepId: "950e8400-e29b-41d4-a716-446655440004",
  destinationUrl: "https://example.com/pricing?utm_source=email",
};

describe("signClickTrackingToken / verifyClickTrackingToken", () => {
  beforeEach(() => {
    vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "test-click-secret-do-not-use-in-prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips: verifying a freshly signed token returns the original context, including the destination", () => {
    const token = signClickTrackingToken(CLICK_CONTEXT);
    expect(verifyClickTrackingToken(token)).toEqual(CLICK_CONTEXT);
  });

  it("produces a URL-safe token (no characters needing percent-encoding)", () => {
    const token = signClickTrackingToken(CLICK_CONTEXT);
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("rejects a token with a tampered signature", () => {
    const token = signClickTrackingToken(CLICK_CONTEXT);
    const [payload, signature] = token.split(".");
    const flipped = signature[0] === "A" ? "B" : "A";
    const tampered = `${payload}.${flipped}${signature.slice(1)}`;
    expect(verifyClickTrackingToken(tampered)).toBeNull();
  });

  it("rejects a token whose destination was swapped for a different URL, reusing the original signature — this is the open-redirect guard", () => {
    const tokenA = signClickTrackingToken(CLICK_CONTEXT);
    const [, signatureA] = tokenA.split(".");
    const forgedContext: ClickTrackingContext = { ...CLICK_CONTEXT, destinationUrl: "https://evil.example.com/phish" };
    const forgedPayload = Buffer.from(
      JSON.stringify([
        forgedContext.campaignId,
        forgedContext.campaignLeadId,
        forgedContext.leadId,
        forgedContext.mailboxId,
        forgedContext.sequenceStepId,
        forgedContext.destinationUrl,
      ]),
      "utf8",
    ).toString("base64url");
    expect(verifyClickTrackingToken(`${forgedPayload}.${signatureA}`)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyClickTrackingToken("")).toBeNull();
    expect(verifyClickTrackingToken("not-a-real-token")).toBeNull();
    expect(verifyClickTrackingToken(".")).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signClickTrackingToken(CLICK_CONTEXT);
    vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "a-completely-different-secret");
    expect(verifyClickTrackingToken(token)).toBeNull();
  });

  it("rejects a token signed with the OPEN-tracking secret even if that secret happens to be known — the two token kinds are not interchangeable", () => {
    vi.stubEnv("TRACKING_TOKEN_SECRET", "test-click-secret-do-not-use-in-prod");
    const openToken = signOpenTrackingToken({
      campaignId: CLICK_CONTEXT.campaignId,
      campaignLeadId: CLICK_CONTEXT.campaignLeadId,
      leadId: CLICK_CONTEXT.leadId,
      mailboxId: CLICK_CONTEXT.mailboxId,
      sequenceStepId: CLICK_CONTEXT.sequenceStepId,
    });
    // Even with the identical secret value, the open-tracking token has a
    // 5-field payload (no destinationUrl) — verifyClickTrackingToken must
    // reject it as malformed, not accept it with a missing 6th field.
    expect(verifyClickTrackingToken(openToken)).toBeNull();
  });

  it("returns null (never throws) when the secret isn't configured at verify time", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "");
    const token = "some.token";
    expect(() => verifyClickTrackingToken(token)).not.toThrow();
    expect(verifyClickTrackingToken(token)).toBeNull();
  });

  it("throws a clear error when the secret isn't configured at sign time", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "");
    expect(() => signClickTrackingToken(CLICK_CONTEXT)).toThrow(/CLICK_TRACKING_TOKEN_SECRET/);
  });

  describe("unsafe destination rejection", () => {
    const UNSAFE_DESTINATIONS = [
      "javascript:alert(document.cookie)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/relative/path",
      "not-a-url-at-all",
      "",
      "//evil.com",
      "///evil.com",
    ];

    it.each(UNSAFE_DESTINATIONS)("signClickTrackingToken refuses to sign destination %j", (destinationUrl) => {
      expect(() => signClickTrackingToken({ ...CLICK_CONTEXT, destinationUrl })).toThrow();
    });

    // Raw control characters: the WHATWG URL Standard silently strips
    // tab/newline/CR while parsing, so new URL("https://x/\r\nY").protocol
    // is still "https:" — a naive protocol-only check would accept a
    // string that still contains those raw bytes, even though the LOCATION
    // header later built from it (app/api/track/click/[token]/route.ts)
    // would receive the un-stripped original. isSafeHttpUrl rejects these
    // before ever calling URL() — see tracking-token.ts.
    const CONTROL_CHARACTER_DESTINATIONS: Record<string, string> = {
      "carriage return (\\r)": "https://evil.example.com/\r\nSet-Cookie: x=1",
      "line feed (\\n)": "https://evil.example.com/\nLocation: http://attacker.example",
      "tab (\\t)": "https://evil.example.com/\tpath",
      "NUL (\\0)": "https://evil.example.com/\0path",
      "DEL (0x7F)": "https://evil.example.com/\x7Fpath",
    };

    it.each(Object.entries(CONTROL_CHARACTER_DESTINATIONS))(
      "signClickTrackingToken refuses to sign a destination containing %s",
      (_label, destinationUrl) => {
        expect(() => signClickTrackingToken({ ...CLICK_CONTEXT, destinationUrl })).toThrow();
      },
    );

    it("verifyClickTrackingToken rejects a token whose destination contains a raw CRLF, even with a valid signature", () => {
      // Hand-crafted (can't go through signClickTrackingToken — it already
      // refuses this at sign time, tested above) to prove verify itself
      // independently enforces this, the same way the javascript: test
      // below does for scheme rejection — the actual boundary
      // app/api/track/click/[token]/route.ts relies on.
      const unsafeContext = { ...CLICK_CONTEXT, destinationUrl: "https://evil.example.com/\r\nSet-Cookie: x=1" };
      const payload = Buffer.from(
        JSON.stringify([
          unsafeContext.campaignId,
          unsafeContext.campaignLeadId,
          unsafeContext.leadId,
          unsafeContext.mailboxId,
          unsafeContext.sequenceStepId,
          unsafeContext.destinationUrl,
        ]),
        "utf8",
      ).toString("base64url");
      const signature = createHmac("sha256", "test-click-secret-do-not-use-in-prod").update(payload).digest("base64url");
      expect(verifyClickTrackingToken(`${payload}.${signature}`)).toBeNull();
    });

    it("verifyClickTrackingToken rejects a token whose destination is a non-http(s) scheme, even with a valid signature", () => {
      // Can't go through signClickTrackingToken (it refuses at sign time
      // too — tested above), so this constructs the token by hand the same
      // way the "destination swapped" test above does, to prove verify
      // itself enforces the scheme independently of sign-time validation.
      const unsafeContext = { ...CLICK_CONTEXT, destinationUrl: "javascript:alert(1)" };
      const payload = Buffer.from(
        JSON.stringify([
          unsafeContext.campaignId,
          unsafeContext.campaignLeadId,
          unsafeContext.leadId,
          unsafeContext.mailboxId,
          unsafeContext.sequenceStepId,
          unsafeContext.destinationUrl,
        ]),
        "utf8",
      ).toString("base64url");
      const signature = createHmac("sha256", "test-click-secret-do-not-use-in-prod").update(payload).digest("base64url");
      expect(verifyClickTrackingToken(`${payload}.${signature}`)).toBeNull();
    });

    it("preserves normal http and https destinations", () => {
      expect(() => signClickTrackingToken({ ...CLICK_CONTEXT, destinationUrl: "http://example.com" })).not.toThrow();
      expect(() => signClickTrackingToken({ ...CLICK_CONTEXT, destinationUrl: "https://example.com/a/b?c=d#e" })).not.toThrow();
    });
  });
});

describe("buildClickTrackingUrl", () => {
  beforeEach(() => {
    vi.stubEnv("CLICK_TRACKING_TOKEN_SECRET", "test-click-secret-do-not-use-in-prod");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds an absolute redirect URL containing a verifiable token bound to the destination", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const url = buildClickTrackingUrl(CLICK_CONTEXT);
    expect(url.startsWith("https://app.example.com/api/track/click/")).toBe(true);

    const token = url.split("/api/track/click/")[1];
    expect(verifyClickTrackingToken(token)).toEqual(CLICK_CONTEXT);
  });

  it("strips a trailing slash from the configured app URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    const url = buildClickTrackingUrl(CLICK_CONTEXT);
    expect(url.startsWith("https://app.example.com/api/track/click/")).toBe(true);
    expect(url).not.toContain("//api/track");
  });

  it("throws a clear error when NEXT_PUBLIC_APP_URL isn't configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(() => buildClickTrackingUrl(CLICK_CONTEXT)).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
