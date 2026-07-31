import { createHmac, timingSafeEqual } from "crypto";

// Stateless signed token: campaign_lead_id + an HMAC over it. No storage —
// verification is just recomputing the signature and comparing, so there's
// no token table to manage, expire, or clean up. Deliberately a different
// key/purpose than lib/crypto/smtp-secret.ts's MAILBOX_ENCRYPTION_KEY (that
// one decrypts real credentials; this one only needs to prove a URL wasn't
// forged) — separate secrets keep the two blast radii independent.
const SEPARATOR = ".";

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "UNSUBSCRIBE_TOKEN_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to .env.local — see .env.example.",
    );
  }
  return secret;
}

function sign(campaignLeadId: string): string {
  return createHmac("sha256", getSecret()).update(campaignLeadId).digest("base64url");
}

// Server-only: called from lib/email/send-worker.ts when building an
// outgoing email, never from a Client Component.
export function signUnsubscribeToken(campaignLeadId: string): string {
  return `${Buffer.from(campaignLeadId, "utf8").toString("base64url")}${SEPARATOR}${sign(campaignLeadId)}`;
}

// Returns the campaign_lead_id if the token is well-formed and its
// signature matches, otherwise null. Never throws on malformed input — a
// tampered or garbage token is just an invalid link, not an error.
export function verifyUnsubscribeToken(token: string): string | null {
  const separatorIndex = token.indexOf(SEPARATOR);
  if (separatorIndex === -1) return null;

  const encodedId = token.slice(0, separatorIndex);
  const providedSignature = token.slice(separatorIndex + 1);

  let campaignLeadId: string;
  try {
    campaignLeadId = Buffer.from(encodedId, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!campaignLeadId) return null;

  const expectedSignature = sign(campaignLeadId);
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);

  // timingSafeEqual throws on mismatched lengths rather than returning
  // false — a forged/truncated signature is exactly the case this needs to
  // handle without throwing, so length is checked first.
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  return campaignLeadId;
}

// Builds the full absolute unsubscribe URL for a campaign_lead — the one
// thing lib/email/send-worker.ts needs from this module. NEXT_PUBLIC_APP_URL
// is required (no relative-URL fallback makes sense inside an email body).
export function buildUnsubscribeUrl(campaignLeadId: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build links inside outgoing emails.");
  }
  return `${appUrl.replace(/\/$/, "")}/unsubscribe/${signUnsubscribeToken(campaignLeadId)}`;
}
