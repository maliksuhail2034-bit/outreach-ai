import { GMAIL_OAUTH_SCOPES } from "./google-constants";

// Plain fetch against Google's OAuth endpoints — no vendor SDK, matching
// this codebase's existing convention for every external HTTP integration
// (lib/integrations/providers/webhook.ts, lib/ai/providers/*.ts). Server-only:
// never call from a Client Component or any code path reachable by client
// bundling — these functions handle the app's own OAuth client secret.
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const REQUEST_TIMEOUT_MS = 15_000;

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set — required to connect a Gmail mailbox. See .env.example.",
    );
  }
  return { clientId, clientSecret };
}

// Same requirement lib/email/unsubscribe-token.ts already has for building
// absolute links — no relative-URL fallback makes sense for a redirect URI
// Google itself has to reach.
function getRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build the Google OAuth redirect URI.");
  }
  return `${appUrl.replace(/\/$/, "")}/api/oauth/google/callback`;
}

// Thrown by exchangeCodeForTokens/refreshGoogleAccessToken/getGoogleUserInfo.
// `outcome` mirrors this codebase's other classified-error shapes
// (EmailSendError, AiGenerationError):
//   "retry"         — transient (network error, 5xx, timeout).
//   "invalid_grant" — Google rejected the refresh token itself (revoked,
//                     expired, or the user removed the app's access) — the
//                     mailbox needs to be reconnected, not retried.
//   "failed"        — terminal for any other reason (bad request, malformed
//                     response).
export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    public readonly outcome: "retry" | "invalid_grant" | "failed",
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

// Builds the URL to redirect the user's browser to for Google's consent
// screen. `access_type=offline` + `prompt=consent` together guarantee a
// refresh token is issued even if this Google account already granted
// these scopes before (Google otherwise omits it on a repeat consent).
export function buildGoogleAuthUrl(state: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GMAIL_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface GoogleTokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function classifyTokenEndpointError(status: number, body: GoogleTokenResponseBody | null): GoogleOAuthError {
  const message = body?.error_description ?? body?.error ?? `Google token request failed (${status}).`;
  if (body?.error === "invalid_grant") {
    return new GoogleOAuthError(message, "invalid_grant");
  }
  if (status === 429 || status >= 500) {
    return new GoogleOAuthError(message, "retry");
  }
  return new GoogleOAuthError(message, "failed");
}

async function postToTokenEndpoint(params: Record<string, string>): Promise<GoogleTokenResponseBody> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
  } catch (error) {
    throw new GoogleOAuthError(
      `Google token request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
      "retry",
    );
  } finally {
    clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => null)) as GoogleTokenResponseBody | null;
  if (!response.ok) {
    throw classifyTokenEndpointError(response.status, body);
  }
  return body ?? {};
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Exchanges the authorization code from the OAuth callback for the initial
// token pair. Only called once, from app/api/oauth/google/callback/route.ts
// — refreshGoogleAccessToken() below is what every later send/reply-sync
// uses.
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = await postToTokenEndpoint({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getRedirectUri(),
    grant_type: "authorization_code",
  });

  if (!body.access_token || !body.refresh_token) {
    // access_type=offline + prompt=consent (see buildGoogleAuthUrl) should
    // always yield a refresh_token on this leg — a missing one is a
    // configuration problem (e.g. scopes changed since last consent), not
    // something to silently proceed without.
    throw new GoogleOAuthError("Google did not return a refresh token for this connection.", "failed");
  }

  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in ?? 3600 };
}

// Exchanges a stored refresh token for a fresh short-lived access token.
// Called fresh on every send/reply-sync (see lib/email/providers/smtp.ts /
// lib/email/reply-providers/imap.ts) rather than caching an access token —
// the same "decrypt/resolve credentials on every use" pattern this app
// already follows for SMTP/IMAP passwords.
export async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = await postToTokenEndpoint({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  if (!body.access_token) {
    throw new GoogleOAuthError("Google did not return an access token for this refresh.", "failed");
  }
  return body.access_token;
}

interface GoogleUserInfoResponseBody {
  email?: string;
  error?: { message?: string };
}

export interface GoogleUserInfo {
  email: string;
}

// Identifies which Google account authorized the connection — used once, at
// callback time, to populate mailboxes.email directly from Google's own
// response rather than trusting a hand-typed form field.
export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } catch (error) {
    throw new GoogleOAuthError(
      `Google userinfo request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
      "retry",
    );
  } finally {
    clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => null)) as GoogleUserInfoResponseBody | null;
  if (!response.ok || !body?.email) {
    throw new GoogleOAuthError(body?.error?.message ?? "Google did not return an account email.", "failed");
  }
  return { email: body.email };
}
