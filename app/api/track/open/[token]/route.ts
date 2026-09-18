import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEmailEvent } from "@/lib/db";
import { verifyOpenTrackingToken } from "@/lib/email/tracking-token";

// Same runtime requirement as every other Route Handler in this codebase
// that touches Supabase server-side (see app/api/health/route.ts).
export const runtime = "nodejs";

// Smallest valid GIF: a 1x1 transparent pixel, 34 bytes. Static bytes, not
// generated per-request — there's nothing request-specific about the image
// itself, only about whether an "opened" event gets recorded alongside it.
const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

const PIXEL_HEADERS = {
  "Content-Type": "image/gif",
  "Content-Length": String(TRANSPARENT_GIF.length),
  // Every open of the same email must reach this route, not a cached copy
  // from a previous open — an email client or intermediate proxy caching
  // this response would silently undercount opens.
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function pixelResponse(): NextResponse {
  return new NextResponse(TRANSPARENT_GIF, { status: 200, headers: PIXEL_HEADERS });
}

// Public, unauthenticated route (outside app/(app)/, same "no session, no
// auth guard" carve-out as app/unsubscribe/[token]/ — an email client
// fetching this image has no session and never will). Runs on the admin
// client for the same reason: a trusted backend process recording an event
// on behalf of a visitor with no session, not a user-scoped mutation (see
// lib/supabase/admin.ts and CLAUDE.md §8).
//
// Always returns the exact same 1x1 pixel, every time, regardless of
// outcome — a missing, tampered, or unrecognized token must look identical
// to a valid one to whatever's requesting it (an email client, a corporate
// image proxy, a recipient's browser devtools). No status code, header, or
// body difference ever reveals whether the token was valid, whether the
// event was recorded, or why it wasn't — nothing about verification or
// recording failures is observable from the response, and nothing here
// throws past this handler.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const context = verifyOpenTrackingToken(token);

    if (context) {
      const supabase = createAdminClient();
      await recordEmailEvent(supabase, {
        campaign_id: context.campaignId,
        lead_id: context.leadId,
        mailbox_id: context.mailboxId,
        event_type: "opened",
        metadata: { sequenceStepId: context.sequenceStepId },
      });
    }
  } catch (error) {
    // Never let a DB error (bad token content that happens to fail the
    // ownership trigger, a transient connection issue, etc.) surface to the
    // requester — log server-side only, still return the pixel below.
    console.error("[track-open] failed to record open event", error instanceof Error ? error.message : "Unknown error");
  }

  return pixelResponse();
}
