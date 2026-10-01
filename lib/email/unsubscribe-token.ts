import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from "crypto";

// Stateless unsubscribe tokens — no storage, nothing to expire or clean up.
// Deliberately a different key/purpose than lib/crypto/smtp-secret.ts's
// MAILBOX_ENCRYPTION_KEY (that one decrypts real credentials; this one only
// needs to prove a URL wasn't forged) — separate secrets keep the two blast
// radii independent.
//
// Two formats:
// - Current ("v2." prefix): the recipient itself — owner user id, email, and
//   the enrollment the email was sent for — encrypted with AES-256-GCM. The
//   unsubscribe resolves from the token alone, so it keeps working after the
//   enrollment, campaign or lead is deleted, and the email isn't readable
//   from the link. The IV is derived from the payload (a synthetic IV), so a
//   recipient's token is the same on every send; GCM only repeats an IV for
//   an identical payload, which reveals nothing beyond that equality.
// - Legacy (no prefix): base64url(campaign_lead_id) + "." + an HMAC over it.
//   Only ever verified, never issued any more; it still needs the enrollment
//   row to find out who it belongs to.
const SEPARATOR = ".";
const RECIPIENT_PREFIX = "v2.";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export interface UnsubscribeRecipient {
  userId: string;
  email: string;
  campaignLeadId: string;
}

export type VerifiedUnsubscribeToken =
  | { kind: "recipient"; recipient: UnsubscribeRecipient }
  | { kind: "legacy"; campaignLeadId: string };

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "UNSUBSCRIBE_TOKEN_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to .env.local — see .env.example.",
    );
  }
  return secret;
}

// One key per purpose, derived from the one configured secret.
function deriveKey(purpose: string): Buffer {
  return createHmac("sha256", getSecret()).update(purpose).digest();
}

// Server-only: called from lib/email/send-worker.ts when building an
// outgoing email, never from a Client Component.
export function signUnsubscribeToken(recipient: UnsubscribeRecipient): string {
  const plaintext = Buffer.from(
    JSON.stringify({ u: recipient.userId, e: recipient.email, c: recipient.campaignLeadId }),
    "utf8",
  );
  const iv = createHmac("sha256", deriveKey("unsubscribe-token:v2:iv"))
    .update(plaintext)
    .digest()
    .subarray(0, IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("unsubscribe-token:v2:encryption"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `${RECIPIENT_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
}

// Null if the token is malformed, tampered with or signed with another
// secret. Never throws on bad input — a garbage token is just an invalid
// link, not an error.
export function verifyUnsubscribeToken(token: string): VerifiedUnsubscribeToken | null {
  if (token.startsWith(RECIPIENT_PREFIX)) {
    const recipient = decryptRecipient(token.slice(RECIPIENT_PREFIX.length));
    return recipient ? { kind: "recipient", recipient } : null;
  }
  const campaignLeadId = verifyLegacyToken(token);
  return campaignLeadId ? { kind: "legacy", campaignLeadId } : null;
}

function decryptRecipient(encoded: string): UnsubscribeRecipient | null {
  const raw = Buffer.from(encoded, "base64url");
  if (raw.length <= IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) return null;

  let payload: unknown;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey("unsubscribe-token:v2:encryption"), raw.subarray(0, IV_LENGTH_BYTES));
    decipher.setAuthTag(raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES));
    const plaintext = Buffer.concat([decipher.update(raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES)), decipher.final()]);
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload !== "object" || payload === null) return null;
  const { u, e, c } = payload as Record<string, unknown>;
  if (typeof u !== "string" || typeof e !== "string" || typeof c !== "string" || !u || !e || !c) return null;
  return { userId: u, email: e, campaignLeadId: c };
}

function verifyLegacyToken(token: string): string | null {
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

  const expectedSignature = createHmac("sha256", getSecret()).update(campaignLeadId).digest("base64url");
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);

  // timingSafeEqual throws on mismatched lengths rather than returning
  // false — a forged/truncated signature is exactly the case this needs to
  // handle without throwing, so length is checked first.
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  return campaignLeadId;
}

// Builds the full absolute unsubscribe URL for one recipient — the one
// thing lib/email/send-worker.ts needs from this module. NEXT_PUBLIC_APP_URL
// is required (no relative-URL fallback makes sense inside an email body).
export function buildUnsubscribeUrl(recipient: UnsubscribeRecipient): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build links inside outgoing emails.");
  }
  return `${appUrl.replace(/\/$/, "")}/unsubscribe/${signUnsubscribeToken(recipient)}`;
}

// The List-Unsubscribe header's URL for an email whose footer links to
// `unsubscribeUrl`: the same token, at the RFC 8058 one-click endpoint
// (app/unsubscribe/[token]/one-click/route.ts). A page and a Route Handler
// can't share one route, so it's a child path of the confirmation page.
export function oneClickUnsubscribeUrl(unsubscribeUrl: string): string {
  return `${unsubscribeUrl}/one-click`;
}
