import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMicrosoftAuthUrl,
  exchangeCodeForTokens,
  getMicrosoftUserInfo,
  MicrosoftOAuthError,
  refreshMicrosoftAccessToken,
} from "./microsoft-oauth";

beforeEach(() => {
  process.env.MICROSOFT_OAUTH_CLIENT_ID = "test-client-id";
  process.env.MICROSOFT_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MICROSOFT_OAUTH_CLIENT_ID;
  delete process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

// Builds a syntactically valid (unsigned) id_token — getMicrosoftUserInfo()
// never verifies the signature (see its own comment on why), so a fixed
// dummy header/signature is fine for exercising the claims-decoding path.
function fakeIdToken(claims: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`;
}

describe("buildMicrosoftAuthUrl", () => {
  it("uses the /common/ endpoint with the client id, redirect uri, scopes, and state", () => {
    const url = new URL(buildMicrosoftAuthUrl("csrf-nonce"));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/oauth/microsoft/callback");
    expect(url.searchParams.get("state")).toBe("csrf-nonce");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("IMAP.AccessAsUser.All");
    expect(url.searchParams.get("scope")).toContain("SMTP.Send");
  });

  it("throws a clear error when client credentials are missing", () => {
    delete process.env.MICROSOFT_OAUTH_CLIENT_ID;
    expect(() => buildMicrosoftAuthUrl("state")).toThrow(/MICROSOFT_OAUTH_CLIENT_ID/);
  });
});

describe("exchangeCodeForTokens", () => {
  it("returns the access token, refresh token, id token, and expiry on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", id_token: "it", expires_in: 3600 }), {
          status: 200,
        }),
      ),
    );

    const tokens = await exchangeCodeForTokens("auth-code");
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", idToken: "it", expiresIn: 3600 });
  });

  it("throws if Microsoft omits a refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "at", id_token: "it" }), { status: 200 }),
      ),
    );

    await expect(exchangeCodeForTokens("auth-code")).rejects.toMatchObject({ outcome: "failed" });
  });

  it("classifies invalid_grant as non-retryable", async () => {
    // A fresh Response per call — a Response body can only be read once,
    // and this test deliberately triggers the request twice.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ error: "invalid_grant", error_description: "Bad code" }), { status: 400 }),
        ),
    );

    await expect(exchangeCodeForTokens("bad-code")).rejects.toBeInstanceOf(MicrosoftOAuthError);
    await expect(exchangeCodeForTokens("bad-code")).rejects.toMatchObject({ outcome: "invalid_grant" });
  });

  it("classifies a 5xx response as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 503 })));
    await expect(exchangeCodeForTokens("auth-code")).rejects.toMatchObject({ outcome: "retry" });
  });

  it("classifies a network error as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(exchangeCodeForTokens("auth-code")).rejects.toMatchObject({ outcome: "retry" });
  });
});

describe("refreshMicrosoftAccessToken", () => {
  it("returns a fresh access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fresh-at", expires_in: 3600 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const accessToken = await refreshMicrosoftAccessToken("stored-refresh-token");
    expect(accessToken).toBe("fresh-at");

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-refresh-token");
  });

  it("classifies a revoked refresh token as invalid_grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })),
    );
    await expect(refreshMicrosoftAccessToken("revoked")).rejects.toMatchObject({ outcome: "invalid_grant" });
  });
});

describe("getMicrosoftUserInfo", () => {
  it("returns the account email from the id_token's email claim", () => {
    const idToken = fakeIdToken({ email: "jane@outlook.com" });
    expect(getMicrosoftUserInfo(idToken)).toEqual({ email: "jane@outlook.com" });
  });

  it("falls back to preferred_username when there's no email claim", () => {
    const idToken = fakeIdToken({ preferred_username: "jane@contoso.com" });
    expect(getMicrosoftUserInfo(idToken)).toEqual({ email: "jane@contoso.com" });
  });

  it("throws if neither claim is present", () => {
    const idToken = fakeIdToken({ sub: "some-id" });
    expect(() => getMicrosoftUserInfo(idToken)).toThrow(MicrosoftOAuthError);
  });

  it("throws on a malformed id_token", () => {
    expect(() => getMicrosoftUserInfo("not-a-jwt")).toThrow(MicrosoftOAuthError);
  });
});
