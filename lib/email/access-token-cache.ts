import { createHash } from "node:crypto";

// In-process cache of OAuth access tokens (Gmail/Outlook SMTP + IMAP).
//
// An access token is good for ~1 hour, but every send and every IMAP poll
// used to exchange the refresh token for a brand-new one: an extra HTTPS
// round trip to Google/Microsoft per email, and a token-endpoint call rate
// that grows with send volume instead of with mailbox count. Caching the
// token until shortly before it expires cuts that to roughly one refresh
// per mailbox per hour.
//
// Keyed by a SHA-256 of the refresh token, never the token itself, so a
// heap dump or debug log of this map exposes no long-lived credential. A
// reconnected mailbox gets a new refresh token and therefore a new key.
// Failures are never cached — the next call simply tries again.

const EXPIRY_SAFETY_MARGIN_MS = 5 * 60_000;
const MAX_ENTRIES = 5_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

function keyFor(provider: string, refreshToken: string): string {
  return `${provider}:${createHash("sha256").update(refreshToken).digest("hex")}`;
}

export async function getCachedAccessToken(
  provider: "google" | "microsoft",
  refreshToken: string,
  refresh: () => Promise<{ accessToken: string; expiresInSeconds: number }>,
  now: () => number = Date.now,
): Promise<string> {
  const key = keyFor(provider, refreshToken);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) return cached.accessToken;

  // Concurrent sends from the same mailbox share one refresh instead of
  // racing several to the token endpoint.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const { accessToken, expiresInSeconds } = await refresh();
      const lifetimeMs = Math.max(0, expiresInSeconds * 1000 - EXPIRY_SAFETY_MARGIN_MS);
      if (lifetimeMs > 0) {
        if (cache.size >= MAX_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, { accessToken, expiresAt: now() + lifetimeMs });
      }
      return accessToken;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}

// Drops a cached token, e.g. after the provider rejected it at AUTH time.
export function invalidateCachedAccessToken(provider: "google" | "microsoft", refreshToken: string): void {
  cache.delete(keyFor(provider, refreshToken));
}

export function clearAccessTokenCache(): void {
  cache.clear();
  inFlight.clear();
}
