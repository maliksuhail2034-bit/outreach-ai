import { NextResponse } from "next/server";
import { runSendWorker } from "@/lib/email/send-worker";

// Triggered by an external scheduler — host-agnostic by design, since the
// deployment target wasn't decided when this was built. Vercel Cron issues
// GET and auto-attaches `Authorization: Bearer $CRON_SECRET` when that env
// var is set; POST is accepted too for manual invocation with the same
// header (GitHub Actions, cron-job.org, local testing, etc.).
//
// nodemailer needs real TCP sockets (SMTP), which the edge runtime can't
// provide — this route must run on Node.js.
export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const summary = await runSendWorker();
    // The only place a run's outcome is visible short of querying the DB
    // directly — logged here (not just returned in the response) so it
    // shows up in hosting/platform logs even if nothing reads the HTTP body.
    console.log("[cron/send-emails]", JSON.stringify({ ...summary, executionTimeMs: Date.now() - startedAt }));
    return NextResponse.json({ ...summary, executionTimeMs: Date.now() - startedAt });
  } catch (error) {
    // Overlapping invocations are already safe — claim_due_sends() and
    // claim_send_attempt() do the actual locking (see lib/email/send-worker.ts).
    // This catch only turns an unexpected error into a structured response
    // instead of an unhandled 500, it adds no locking of its own.
    const errorMessage = error instanceof Error ? error.message : "Unknown error running the send worker.";
    console.error("[cron/send-emails]", JSON.stringify({ error: errorMessage, executionTimeMs: Date.now() - startedAt }));
    return NextResponse.json({ error: errorMessage, executionTimeMs: Date.now() - startedAt }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
