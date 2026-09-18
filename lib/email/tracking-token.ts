import { createHmac, timingSafeEqual } from "crypto";

// Stateless signed token for the open-tracking pixel — same shape as
// lib/email/unsubscribe-token.ts (base64url payload + HMAC-SHA256
// signature, no storage, no expiry: verification is just recomputing the
// signature and comparing). A different secret from
// UNSUBSCRIBE_TOKEN_SECRET on purpose, same reasoning that file documents
// for MAILBOX_ENCRYPTION_KEY/AI_PROVIDER_KEY_ENCRYPTION_KEY/
// VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY: a leaked tracking secret would
// let someone forge fake "opened" events, a different blast radius than
// forging an unsubscribe.
//
// Unlike the unsubscribe token (which only needs campaign_lead_id — the
// rest is looked up fresh from the DB), this token carries every id needed
// to attribute an "opened" event by itself: campaign_id, campaign_lead_id,
// lead_id, mailbox_id, and sequence_step_id. mailbox_id in particular is
// NOT safe to re-derive from campaign_leads at pixel-hit time — a lead's
// mailbox assignment can change between sequence steps (mailbox pool
// rotation, see campaign_mailboxes), so a pixel embedded in a step-1 email
// must always attribute back to the mailbox that step 1 actually sent
// from, not whatever campaign_leads.mailbox_id happens to hold when the
// recipient later opens it. sequence_step_id has the same problem via
// campaign_leads.current_step_id (which advances as the lead progresses),
// so it's embedded directly too rather than derived.
//
// The payload is base64url-encoded, not encrypted — the ids are readable
// by anyone who decodes it, same as the unsubscribe token's campaign_lead_id
// today. That's fine: none of these ids are secret on their own (they're
// already visible in this app's own authenticated URLs), and the HMAC
// signature is what prevents a forged or altered set of ids from ever being
// accepted, which is the actual security property this token needs.
const SEPARATOR = ".";

export interface OpenTrackingContext {
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  mailboxId: string;
  sequenceStepId: string;
}

function getSecret(): string {
  const secret = process.env.TRACKING_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "TRACKING_TOKEN_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to .env.local — see .env.example.",
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

// Order matters here — verifyOpenTrackingToken reads positionally, not by
// key, to keep the encoded payload as small as possible (this ends up in a
// URL embedded in every outgoing email).
function encodeContext(context: OpenTrackingContext): string {
  const tuple = [context.campaignId, context.campaignLeadId, context.leadId, context.mailboxId, context.sequenceStepId];
  return Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url");
}

// Server-only: called from lib/email/send-worker.ts when building an
// outgoing email, never from a Client Component.
export function signOpenTrackingToken(context: OpenTrackingContext): string {
  const encoded = encodeContext(context);
  return `${encoded}${SEPARATOR}${sign(encoded)}`;
}

// Returns the decoded context if the token is well-formed and its
// signature matches, otherwise null. Never throws on malformed, tampered,
// or garbage input (including a config error surfaced as a thrown Error
// from getSecret — callers like the tracking pixel route must never 500 on
// a bad token) — an invalid token is just "don't record an event", not an
// error.
export function verifyOpenTrackingToken(token: string): OpenTrackingContext | null {
  try {
    const separatorIndex = token.indexOf(SEPARATOR);
    if (separatorIndex === -1) return null;

    const encodedPayload = token.slice(0, separatorIndex);
    const providedSignature = token.slice(separatorIndex + 1);

    // Signature is verified against the raw encoded payload string BEFORE
    // it's ever decoded/parsed — a tampered payload fails here regardless
    // of whether it happens to still be valid base64/JSON.
    const expectedSignature = sign(encodedPayload);
    const expected = Buffer.from(expectedSignature);
    const provided = Buffer.from(providedSignature);

    // timingSafeEqual throws on mismatched lengths rather than returning
    // false — a forged/truncated signature is exactly the case this needs
    // to handle without throwing.
    if (expected.length !== provided.length) return null;
    if (!timingSafeEqual(expected, provided)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    } catch {
      return null;
    }

    if (!Array.isArray(parsed) || parsed.length !== 5 || !parsed.every((value) => typeof value === "string" && value.length > 0)) {
      return null;
    }

    const [campaignId, campaignLeadId, leadId, mailboxId, sequenceStepId] = parsed as string[];
    return { campaignId, campaignLeadId, leadId, mailboxId, sequenceStepId };
  } catch {
    // Covers getSecret() throwing (TRACKING_TOKEN_SECRET unset) and any
    // other unexpected decoding error — the pixel route must always be
    // able to treat this as "invalid token", never crash.
    return null;
  }
}

// Builds the full absolute open-tracking pixel URL for one outbound send —
// the one thing lib/email/send-worker.ts needs from this module.
// NEXT_PUBLIC_APP_URL is required (no relative-URL fallback makes sense
// inside an email body), same requirement buildUnsubscribeUrl already has.
export function buildOpenTrackingUrl(context: OpenTrackingContext): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build links inside outgoing emails.");
  }
  return `${appUrl.replace(/\/$/, "")}/api/track/open/${signOpenTrackingToken(context)}`;
}
