import type { NextResponse } from "next/server";
import { runWarmupCycleWorker } from "@/lib/warmup/warmup-worker";
import { runCronJob } from "@/lib/monitoring/run-cron-job";

// Triggered by an external scheduler — same host-agnostic shape as every
// other cron route (see app/api/cron/send-emails/route.ts). Vercel Cron
// issues GET and auto-attaches `Authorization: Bearer $CRON_SECRET` when
// that env var is set; POST is accepted too for manual invocation with the
// same header (GitHub Actions, cron-job.org, local testing, etc.).
//
// WARMUP_DRY_RUN is read here, once, and passed into the worker as a plain
// argument — the worker itself never reads process.env (same separation
// send-emails/sync-replies already keep between CRON_SECRET and their
// workers). See lib/warmup/warmup-worker.ts's RunWarmupCycleOptions for
// exactly what dry-run skips.
//
// nodemailer/ImapFlow need real TCP sockets, which the edge runtime can't
// provide — this route must run on Node.js.
export const runtime = "nodejs";

function handle(request: Request): Promise<NextResponse> {
  const dryRun = process.env.WARMUP_DRY_RUN === "true";
  return runCronJob(request, "warmup-cycle", (supabase) => runWarmupCycleWorker(supabase, { dryRun }));
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
