import { MICROSOFT_OAUTH_SCOPES } from "./microsoft-constants";

// Plain fetch against Microsoft's OAuth endpoints — no vendor SDK (no MSAL,
// no Graph client), matching this codebase's existing convention for every
// external HTTP integration and mirroring lib/email/google-oauth.ts exactly.
// Server-only: never call from a Client Component or any code path reachable
// by client bundling — these functions handle the app's own OAuth client
// secret.
//
// Uses the /common/ authorize+token endpoints (not /organizations/ or
// /consumers/) so a single app registration accepts both Microsoft 365
// work/school accounts and personal Outlook.com accounts through the same
// flow — the app registration itself must be configured for "Accounts in
// any organizational directory and personal Microsoft accounts" for this to
// work; see .env.example.
const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const REQUEST_TIMEOUT_MS = 15_000;

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "MICROSOFT_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_SECRET are not set — required to connect a Microsoft 365/Outlook mailbox. See .env.example.",
    );
  }
  return { clientId, clientSecret };
}

// Same requirement google-oauth.ts's getRedirectUri() has — no relative-URL
// fallback makes sense for a redirect URI Microsoft itself has to reach.
function getRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build the Microsoft OAuth redirect URI.");
  }
  return `${appUrl.replace(/\/$/, "")}/api/oauth/microsoft/callback`;
}

// Thrown by exchangeCodeForTokens/refreshMicrosoftAccessToken. `outcome`
// mirrors GoogleOAuthError's shape exactly:
//   "retry"         — transient (network error, 5xx, timeout, or Microsoft's
//                      429).
//   "invalid_grant" — Microsoft rejected the refresh token itself (revoked,
//                     expired, or the user removed the app's access) — the
//                     mailbox needs to be reconnected, not retried.
//   "failed"        — terminal for any other reason (bad request, malformed
//                     response).
export class MicrosoftOAuthError extends Error {
  constructor(
    message: string,
    public readonly outcome: "retry" | "invalid_grant" | "failed",
  ) {
    super(message);
    this.name = "MicrosoftOAuthError";
  }
}

// Builds the URL to redirect the user's browser to for Microsoft's consent
// screen. Unlike Google, Microsoft always returns a refresh token on the
// authorization_code exchange as long as offline_access was granted — no
// access_type=offline/prompt=consent equivalent is needed to force one on a
// repeat consent.
export function buildMicrosoftAuthUrl(state: string): string {
  const { clientId } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_OAUTH_SCOPES.join(" "),
    state,
  });
  return `${MICROSOFT_AUTH_URL}?${params.toString()}`;
}

interface MicrosoftTokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function classifyTokenEndpointError(status: number, body: MicrosoftTokenResponseBody | null): MicrosoftOAuthError {
  const message = body?.error_description ?? body?.error ?? `Microsoft token request failed (${status}).`;
  if (body?.error === "invalid_grant") {
    return new MicrosoftOAuthError(message, "invalid_grant");
  }
  if (status === 429 || status >= 500) {
    return new MicrosoftOAuthError(message, "retry");
  }
  return new MicrosoftOAuthError(message, "failed");
}

async function postToTokenEndpoint(params: Record<string, string>): Promise<MicrosoftTokenResponseBody> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(MICROSOFT_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
  } catch (error) {
    throw new MicrosoftOAuthError(
      `Microsoft token request failed: ${error instanceof Error ? error.message : "unknown network error"}`,
      "retry",
    );
  } finally {
    clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => null)) as MicrosoftTokenResponseBody | null;
  if (!response.ok) {
    throw classifyTokenEndpointError(response.status, body);
  }
  return body ?? {};
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresIn: number;
}

// Exchanges the authorization code from the OAuth callback for the initial
// token set. Only called once, from
// app/api/oauth/microsoft/callback/route.ts — refreshMicrosoftAccessToken()
// below is what every later send/reply-sync uses.
export async function exchangeCodeForTokens(code: string): Promise<MicrosoftTokens> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = await postToTokenEndpoint({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getRedirectUri(),
    grant_type: "authorization_code",
  });

  if (!body.access_token || !body.refresh_token || !body.id_token) {
    // offline_access (see microsoft-constants.ts) should always yield a
    // refresh_token on this leg, and openid should always yield an
    // id_token — a missing one is a configuration problem (e.g. the app
    // registration's requested scopes don't match what was actually
    // granted), not something to silently proceed without.
    throw new MicrosoftOAuthError("Microsoft did not return a complete token set for this connection.", "failed");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    idToken: body.id_token,
    expiresIn: body.expires_in ?? 3600,
  };
}

// Exchanges a stored refresh token for a fresh short-lived access token.
// Called fresh on every send/reply-sync (see lib/email/providers/smtp.ts /
// lib/email/reply-providers/imap.ts) rather than caching an access token —
// the same "decrypt/resolve credentials on every use" pattern this app
// already follows for SMTP/IMAP passwords and the Google refresh token.
// Microsoft's documented refresh flow expects the original scope on the
// refresh request too (unlike Google's), so it's included here.
export async function refreshMicrosoftAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = await postToTokenEndpoint({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    scope: MICROSOFT_OAUTH_SCOPES.join(" "),
    grant_type: "refresh_token",
  });

  if (!body.access_token) {
    throw new MicrosoftOAuthError("Microsoft did not return an access token for this refresh.", "failed");
  }
  return body.access_token;
}

export interface MicrosoftUserInfo {
  email: string;
}

interface MicrosoftIdTokenClaims {
  email?: string;
  preferred_username?: string;
}

// Identifies which Microsoft account authorized the connection — used once,
// at callback time, to populate mailboxes.email directly from Microsoft's
// own response rather than trusting a hand-typed form field. Mirrors
// getGoogleUserInfo()'s role exactly, but reads the `email` claim straight
// out of the id_token (JWT) already returned by exchangeCodeForTokens()
// instead of a second network call — Microsoft's OpenID Connect id_token
// carries this claim when `openid`+`email` are requested (see
// microsoft-constants.ts), so no Microsoft Graph call is needed just to
// identify the account. The id_token's signature is not verified here: it
// came directly from Microsoft's token endpoint over TLS in the same
// response as the access/refresh tokens, the same trust boundary
// getGoogleUserInfo() already relies on for Google's userinfo response —
// this function never uses the id_token to authorize anything, only to
// label a mailbox row.
export function getMicrosoftUserInfo(idToken: string): MicrosoftUserInfo {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new MicrosoftOAuthError("Microsoft returned a malformed id_token.", "failed");
  }

  let claims: MicrosoftIdTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as MicrosoftIdTokenClaims;
  } catch {
    throw new MicrosoftOAuthError("Microsoft returned a malformed id_token.", "failed");
  }

  // `email` isn't guaranteed present on every account (Microsoft's own
  // caveat); `preferred_username` is Microsoft's documented fallback and is
  // the account's sign-in identifier, which for both Outlook.com and
  // Microsoft 365 mailbox accounts is their mailbox address.
  const email = claims.email ?? claims.preferred_username;
  if (!email) {
    throw new MicrosoftOAuthError("Microsoft did not return an account email.", "failed");
  }
  return { email };
}
