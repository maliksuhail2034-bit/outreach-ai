import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  GoogleOAuthError,
  refreshGoogleAccessToken,
} from "./google-oauth";

beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe("buildGoogleAuthUrl", () => {
  it("includes the client id, redirect uri, scopes, offline access, and state", () => {
    const url = new URL(buildGoogleAuthUrl("csrf-nonce"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/oauth/google/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("csrf-nonce");
    expect(url.searchParams.get("scope")).toContain("mail.google.com");
  });

  it("throws a clear error when client credentials are missing", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => buildGoogleAuthUrl("state")).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });
});

describe("exchangeCodeForTokens", () => {
  it("returns the access token, refresh token, and expiry on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 }),
      ),
    );

    const tokens = await exchangeCodeForTokens("auth-code");
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
  });

  it("throws if Google omits a refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "at" }), { status: 200 })),
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

    await expect(exchangeCodeForTokens("bad-code")).rejects.toBeInstanceOf(GoogleOAuthError);
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

describe("refreshGoogleAccessToken", () => {
  it("returns a fresh access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fresh-at", expires_in: 3600 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const accessToken = await refreshGoogleAccessToken("stored-refresh-token");
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
    await expect(refreshGoogleAccessToken("revoked")).rejects.toMatchObject({ outcome: "invalid_grant" });
  });
});

describe("getGoogleUserInfo", () => {
  it("returns the account email on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ email: "jane@gmail.com" }), { status: 200 })));
    await expect(getGoogleUserInfo("access-token")).resolves.toEqual({ email: "jane@gmail.com" });
  });

  it("throws if Google returns no email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
    await expect(getGoogleUserInfo("access-token")).rejects.toBeInstanceOf(GoogleOAuthError);
  });
});
