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

// Batch 9B: click tracking. Same base pattern as the open-tracking token
// above (base64url payload + HMAC-SHA256 signature, no storage, no
// expiry — same reasoning), but with two differences:
//
// 1. A DIFFERENT secret (CLICK_TRACKING_TOKEN_SECRET, not
//    TRACKING_TOKEN_SECRET) — same "separate blast radius per secret"
//    convention this file's own header comment documents for
//    MAILBOX_ENCRYPTION_KEY/AI_PROVIDER_KEY_ENCRYPTION_KEY/etc., but for a
//    concretely different reason here: a leaked open-tracking secret can
//    only forge fake "opened" rows, while a leaked click-tracking secret
//    could additionally be used to mint a polimatiq.com URL that redirects
//    anywhere the holder chooses (an open-redirect-as-a-service off this
//    app's own trusted domain) — a meaningfully worse blast radius, so it
//    gets its own key rather than reusing the pixel's.
//
// 2. The payload carries a 6th field, destinationUrl — the exact original
//    href this click must redirect to. Binding it into the SIGNED payload
//    (never as a separate, unsigned query param) is what prevents an open
//    redirect via a tampered link: destinationUrl can't be swapped for a
//    different URL without invalidating the whole signature, exactly like
//    swapping mailboxId/sequenceStepId on the open-tracking token can't
//    (see tracking-token.test.ts). verifyClickTrackingToken additionally
//    enforces that destinationUrl is a real http(s) absolute URL as part
//    of what "verified" means — see isSafeHttpUrl below — so a caller
//    holding a non-null result from that function never has to re-check
//    the scheme itself; that guarantee is the actual thing preventing
//    javascript:/data:/other unsafe redirect targets from ever reaching
//    app/api/track/click/[token]/route.ts's NextResponse.redirect call.
export interface ClickTrackingContext {
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  mailboxId: string;
  sequenceStepId: string;
  destinationUrl: string;
}

function getClickSecret(): string {
  const secret = process.env.CLICK_TRACKING_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "CLICK_TRACKING_TOKEN_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to .env.local — see .env.example.",
    );
  }
  return secret;
}

function signClick(payload: string): string {
  return createHmac("sha256", getClickSecret()).update(payload).digest("base64url");
}

// Raw ASCII control characters (0x00-0x1F, plus DEL 0x7F) — checked BEFORE
// handing the string to URL() below. The WHATWG URL Standard silently
// strips tab/newline/CR while parsing (new URL("https://x/\r\nY").protocol
// is still "https:"), so a naive protocol-only check would accept a string
// that still contains those raw bytes even though the check itself only
// ever "saw" the stripped form — the same class of parse/validate mismatch
// this codebase already got burned by once (see the safe-redirect
// tab/newline/CR fix). Rejecting here means the string that gets
// validated and the string that later goes into a Location header
// (app/api/track/click/[token]/route.ts) are always the same bytes.
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/;

// Only http:// and https:// are ever a safe click-tracking destination.
// Anything else (javascript:, data:, vbscript:, file:, a bare relative
// path with no scheme at all, a protocol-relative "//host" with no scheme)
// is rejected — checked here rather than with a denylist, the same
// allowlist-over-denylist choice lib/email/render-email.ts's
// SAFE_URL_PATTERN already makes for which bare-text URLs get linkified in
// the first place. Used at both sign time (defense in depth against a
// future caller of signClickTrackingToken — today's only caller,
// send-worker.ts's rewriteClickTrackingLinks, already only ever captures an
// http(s) href with no control characters by construction) and verify time
// (the actual enforcement boundary the click route relies on).
function isSafeHttpUrl(value: string): boolean {
  if (CONTROL_CHARACTER_PATTERN.test(value)) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Order matters — read positionally by verifyClickTrackingToken, same
// reasoning as encodeContext above.
function encodeClickContext(context: ClickTrackingContext): string {
  const tuple = [
    context.campaignId,
    context.campaignLeadId,
    context.leadId,
    context.mailboxId,
    context.sequenceStepId,
    context.destinationUrl,
  ];
  return Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url");
}

// Server-only: called from lib/email/send-worker.ts when rewriting an
// outgoing email's links, never from a Client Component.
export function signClickTrackingToken(context: ClickTrackingContext): string {
  if (!isSafeHttpUrl(context.destinationUrl)) {
    throw new Error("Refusing to sign a click-tracking token for a non-http(s) destination.");
  }
  const encoded = encodeClickContext(context);
  return `${encoded}${SEPARATOR}${signClick(encoded)}`;
}

// Returns the decoded context if the token is well-formed, its signature
// matches, AND destinationUrl is a safe http(s) URL — otherwise null.
// That last check makes a non-null return value a load-bearing guarantee:
// app/api/track/click/[token]/route.ts redirects to context.destinationUrl
// without re-validating the scheme itself, because this function already
// did. Never throws, same reasoning as verifyOpenTrackingToken above.
export function verifyClickTrackingToken(token: string): ClickTrackingContext | null {
  try {
    const separatorIndex = token.indexOf(SEPARATOR);
    if (separatorIndex === -1) return null;

    const encodedPayload = token.slice(0, separatorIndex);
    const providedSignature = token.slice(separatorIndex + 1);

    const expectedSignature = signClick(encodedPayload);
    const expected = Buffer.from(expectedSignature);
    const provided = Buffer.from(providedSignature);

    if (expected.length !== provided.length) return null;
    if (!timingSafeEqual(expected, provided)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    } catch {
      return null;
    }

    if (!Array.isArray(parsed) || parsed.length !== 6 || !parsed.every((value) => typeof value === "string" && value.length > 0)) {
      return null;
    }

    const [campaignId, campaignLeadId, leadId, mailboxId, sequenceStepId, destinationUrl] = parsed as string[];

    if (!isSafeHttpUrl(destinationUrl)) return null;

    return { campaignId, campaignLeadId, leadId, mailboxId, sequenceStepId, destinationUrl };
  } catch {
    return null;
  }
}

// Builds the full absolute click-tracking redirect URL for one link inside
// one outbound send — the one thing lib/email/send-worker.ts needs from
// this module. Same NEXT_PUBLIC_APP_URL requirement as buildOpenTrackingUrl.
export function buildClickTrackingUrl(context: ClickTrackingContext): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set — required to build links inside outgoing emails.");
  }
  return `${appUrl.replace(/\/$/, "")}/api/track/click/${signClickTrackingToken(context)}`;
}
