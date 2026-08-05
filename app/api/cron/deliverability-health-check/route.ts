import type { NextResponse } from "next/server";
import { runDeliverabilityHealthCheckWorker } from "@/lib/deliverability/health-check-worker";
import { runCronJob } from "@/lib/monitoring/run-cron-job";

// Same host-agnostic trigger model as the other cron routes (send-emails,
// sync-replies): any external scheduler hitting this on an interval, GET
// (Vercel Cron) or POST (manual/other schedulers), with the same
// CRON_SECRET bearer header.
//
// Unlike send-emails/sync-replies, nothing here needs raw TCP sockets — the
// worker only talks to Supabase over HTTP — but this is pinned to Node.js
// anyway to keep the deployment target consistent across every cron route.
export const runtime = "nodejs";

function handle(request: Request): Promise<NextResponse> {
  return runCronJob(request, "deliverability-health-check", () => runDeliverabilityHealthCheckWorker());
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
