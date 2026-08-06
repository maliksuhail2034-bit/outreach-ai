import type { NextResponse } from "next/server";
import { runReplySyncWorker } from "@/lib/email/reply-worker";
import { runCronJob } from "@/lib/monitoring/run-cron-job";

// Separate route, separate worker, from app/api/cron/send-emails/route.ts —
// deliberately not sharing worker code with it (see the reply-tracking
// plan's note on this tradeoff), so nothing here can affect the send
// pipeline. Both do share runCronJob (lib/monitoring/run-cron-job.ts), which
// only wraps route-level auth/logging/job_runs/heartbeat plumbing, not
// worker orchestration. Same host-agnostic trigger model: any external
// scheduler hitting this on an interval, GET (Vercel Cron) or POST
// (manual/other schedulers) with the same CRON_SECRET bearer header.
//
// imapflow/mailparser need real TCP sockets and Node APIs, same reasoning
// as the send route — this must run on Node.js, not the edge runtime.
export const runtime = "nodejs";

function handle(request: Request): Promise<NextResponse> {
  return runCronJob(request, "sync-replies", (supabase) => runReplySyncWorker(supabase));
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
