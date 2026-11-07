import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEngagement } from "@/lib/email/record-engagement";
import { verifyClickTrackingToken } from "@/lib/email/tracking-token";
import { resolveLegacyClickToken } from "@/lib/email/legacy-click-token";

// Same runtime requirement as every other Route Handler in this codebase
// that touches Supabase server-side (see app/api/health/route.ts and
// app/api/track/open/[token]/route.ts).
export const runtime = "nodejs";

// A tracking link is something the recipient actively clicks, unlike the
// open pixel (a background image fetch) — an invalid/tampered token here
// must NOT silently redirect anywhere (not even to this app's own
// homepage): a redirect response always carries a Location header the
// caller controls the meaning of, and "reject safely" for an active
// navigation means the generic, static response below instead — no
// Location header, no hint of the original destination, no internal detail
// about why verification failed.
function rejectedResponse(): NextResponse {
  return new NextResponse("This link is invalid or has expired.", {
    status: 400,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

// Public, unauthenticated route (outside app/(app)/, same "no session, no
// auth guard" carve-out as app/unsubscribe/[token]/ and
// app/api/track/open/[token]/route.ts — the recipient clicking a link in an
// email has no session). Runs on the admin client for the same reason: a
// trusted backend process recording an event on behalf of a visitor with no
// session (see lib/supabase/admin.ts and CLAUDE.md §8).
//
// verifyClickTrackingToken is the entire security boundary this handler
// relies on: a non-null result is already guaranteed to (a) have a
// signature that matches every field, including destinationUrl, so none of
// them — least of all the destination — could have been swapped after
// signing, and (b) have a destinationUrl that is a real http(s) absolute
// URL, never javascript:/data:/anything else. Nothing below re-derives or
// re-validates the destination; it doesn't need to.
//
// The one exception is a link signed with a since-lost secret: see
// lib/email/legacy-click-token.ts, which only accepts a destination the
// stored, actually-sent step contains for that lead.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyClickTrackingToken(token);
  const context = verified ?? (await resolveLegacyClickToken(token));

  if (!context) {
    return rejectedResponse();
  }

  try {
    const supabase = createAdminClient();
    // Classified person vs link scanner (email_events.is_bot); a person's
    // click also implies an open when none was recorded.
    await recordEngagement(
      supabase,
      "clicked",
      { campaignId: context.campaignId, campaignLeadId: context.campaignLeadId, leadId: context.leadId, mailboxId: context.mailboxId, sequenceStepId: context.sequenceStepId },
      request.headers.get("user-agent"),
      { destinationUrl: context.destinationUrl, ...(verified ? {} : { legacyToken: true }) },
    );
  } catch (error) {
    // Never let a DB error block the redirect or surface to the recipient
    // — a missed click event is far better than a broken link. Logged
    // server-side only, same as the open-tracking route.
    console.error("[track-click] failed to record click event", error instanceof Error ? error.message : "Unknown error");
  }

  return NextResponse.redirect(context.destinationUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" },
  });
}
