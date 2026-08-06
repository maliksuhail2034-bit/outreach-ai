import type { NextResponse } from "next/server";
import { runSendWorker } from "@/lib/email/send-worker";
import { runCronJob } from "@/lib/monitoring/run-cron-job";

// Triggered by an external scheduler — host-agnostic by design, since the
// deployment target wasn't decided when this was built. Vercel Cron issues
// GET and auto-attaches `Authorization: Bearer $CRON_SECRET` when that env
// var is set; POST is accepted too for manual invocation with the same
// header (GitHub Actions, cron-job.org, local testing, etc.).
//
// nodemailer needs real TCP sockets (SMTP), which the edge runtime can't
// provide — this route must run on Node.js.
export const runtime = "nodejs";

function handle(request: Request): Promise<NextResponse> {
  return runCronJob(request, "send-emails", (supabase) => runSendWorker(supabase));
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
