import type { NextResponse } from "next/server";
import { runVerificationWorker } from "@/lib/verification/bulk-worker";
import { runCronJob } from "@/lib/monitoring/run-cron-job";

// Same host-agnostic trigger model as the other cron routes (send-emails,
// sync-replies, deliverability-health-check, integrations-digest): any
// external scheduler hitting this on an interval, GET (Vercel Cron) or POST
// (manual/other schedulers), with the same CRON_SECRET bearer header.
export const runtime = "nodejs";

function handle(request: Request): Promise<NextResponse> {
  return runCronJob(request, "verify-leads", () => runVerificationWorker());
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
