import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/auth", () => ({
  getUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  createMailbox: vi.fn(),
  getMailboxByUserAndEmail: vi.fn(),
  getUserOrganization: vi.fn(),
  recordAuditEvent: vi.fn(),
  updateMailbox: vi.fn(),
}));
vi.mock("@/lib/email/google-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/google-oauth")>()),
  buildGoogleAuthUrl: vi.fn((state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
  exchangeCodeForTokens: vi.fn(),
}));
vi.mock("@/lib/email/microsoft-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/microsoft-oauth")>()),
  buildMicrosoftAuthUrl: vi.fn((state: string) => `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${state}`),
  exchangeCodeForTokens: vi.fn(),
}));

import { getUser } from "@/lib/supabase/auth";
import { exchangeCodeForTokens as exchangeGoogleCode } from "@/lib/email/google-oauth";
import { buildGoogleAuthUrl } from "@/lib/email/google-oauth";
import { buildMicrosoftAuthUrl, exchangeCodeForTokens as exchangeMicrosoftCode } from "@/lib/email/microsoft-oauth";
import { GET as googleStart, STATE_COOKIE_NAME as GOOGLE_STATE_COOKIE } from "./google/start/route";
import { GET as googleCallback } from "./google/callback/route";
import { GET as microsoftStart, STATE_COOKIE_NAME as MICROSOFT_STATE_COOKIE } from "./microsoft/start/route";
import { GET as microsoftCallback } from "./microsoft/callback/route";

const mockGetUser = vi.mocked(getUser);
const BASE = "https://polimatiq.test";

function request(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(`${BASE}${path}`);
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", BASE);
});

describe.each([
  { provider: "google", start: googleStart, providerHost: "accounts.google.com", cookie: GOOGLE_STATE_COOKIE },
  { provider: "microsoft", start: microsoftStart, providerHost: "login.microsoftonline.com", cookie: MICROSOFT_STATE_COOKIE },
])("/api/oauth/$provider/start", ({ start, providerHost, cookie }) => {
  it("redirects a signed-out visitor to /login instead of failing", async () => {
    mockGetUser.mockResolvedValue(null);

    const response = await start();

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(response.cookies.get(cookie)).toBeUndefined();
  });

  it("redirects a signed-in user to the provider with a state cookie", async () => {
    mockGetUser.mockResolvedValue({ id: "user-1", email: "a@example.com" } as User);

    const response = await start();

    const location = new URL(response.headers.get("location")!);
    expect(location.host).toBe(providerHost);
    const state = response.cookies.get(cookie)?.value;
    expect(state).toBeTruthy();
    expect(location.searchParams.get("state")).toBe(state);
  });
});

describe("/api/oauth/google/start without Google credentials", () => {
  it("sends a signed-in user back to /mailboxes with a friendly error instead of a 500", async () => {
    mockGetUser.mockResolvedValue({ id: "user-1", email: "a@example.com" } as User);
    vi.mocked(buildGoogleAuthUrl).mockImplementationOnce(() => {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set");
    });

    const response = await googleStart();

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/mailboxes");
    expect(location.searchParams.get("error")).toBe("Google Workspace connection isn't set up yet. Try again later.");
    expect(response.cookies.get(GOOGLE_STATE_COOKIE)).toBeUndefined();
  });
});

describe("/api/oauth/microsoft/start without Microsoft credentials", () => {
  it("sends a signed-in user back to /mailboxes with a friendly error", async () => {
    mockGetUser.mockResolvedValue({ id: "user-1", email: "a@example.com" } as User);
    vi.mocked(buildMicrosoftAuthUrl).mockImplementationOnce(() => {
      throw new Error("MICROSOFT_OAUTH_CLIENT_ID is not set");
    });

    const response = await microsoftStart();

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/mailboxes");
    expect(location.searchParams.get("error")).toBe("Microsoft 365 connection isn't set up yet. Try again later.");
  });
});

describe.each([
  { provider: "google", callback: googleCallback, cookie: GOOGLE_STATE_COOKIE, exchange: exchangeGoogleCode },
  { provider: "microsoft", callback: microsoftCallback, cookie: MICROSOFT_STATE_COOKIE, exchange: exchangeMicrosoftCode },
])("/api/oauth/$provider/callback", ({ provider, callback, cookie, exchange }) => {
  it("sends a user whose session expired mid-flow to /login without touching the provider", async () => {
    mockGetUser.mockResolvedValue(null);

    const response = await callback(
      request(`/api/oauth/${provider}/callback?code=auth-code&state=matching-state`, { [cookie]: "matching-state" }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("Your session expired. Sign in and connect the mailbox again.");
    // The one-time state cookie is cleared so a retry starts a fresh flow.
    expect(response.cookies.get(cookie)?.value).toBe("");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("still rejects a mismatched state before checking the session", async () => {
    const response = await callback(
      request(`/api/oauth/${provider}/callback?code=auth-code&state=forged`, { [cookie]: "matching-state" }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/mailboxes");
    expect(location.searchParams.get("error")).toBe("This connection request is invalid or expired. Try connecting again.");
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

// Behind Caddy on the VPS, Next.js sees its internal listener
// (https://localhost:3001) as the request URL. Every redirect must use the
// configured public origin instead; before this fix they went to localhost.
describe("redirects behind a reverse proxy", () => {
  const INTERNAL = "https://localhost:3001";
  const PUBLIC = "https://app.polimatiq.example";

  function internalRequest(path: string, cookies: Record<string, string> = {}) {
    const req = new NextRequest(`${INTERNAL}${path}`);
    for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
    return req;
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", PUBLIC);
  });

  it.each([
    ["google start, signed out", () => googleStart()],
    ["microsoft start, signed out", () => microsoftStart()],
    ["google callback, provider error", () => googleCallback(internalRequest("/api/oauth/google/callback?error=access_denied"))],
    ["microsoft callback, provider error", () => microsoftCallback(internalRequest("/api/oauth/microsoft/callback?error=access_denied"))],
    [
      "google callback, expired session",
      () => googleCallback(internalRequest("/api/oauth/google/callback?code=c&state=s", { [GOOGLE_STATE_COOKIE]: "s" })),
    ],
    [
      "microsoft callback, expired session",
      () => microsoftCallback(internalRequest("/api/oauth/microsoft/callback?code=c&state=s", { [MICROSOFT_STATE_COOKIE]: "s" })),
    ],
  ])("%s redirects to the public origin, never the internal host", async (_label, run) => {
    mockGetUser.mockResolvedValue(null);

    const location = new URL((await run()).headers.get("location")!);

    expect(location.origin).toBe(PUBLIC);
  });

  it("fails closed instead of redirecting to the request host when NEXT_PUBLIC_APP_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    mockGetUser.mockResolvedValue(null);

    await expect(googleStart()).rejects.toThrow("NEXT_PUBLIC_APP_URL is not set");
  });
});
