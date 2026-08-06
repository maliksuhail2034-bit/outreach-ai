import type { NextResponse } from "next/server";
import { runAnalyticsRollupWorker } from "@/lib/analytics/rollup-worker";
import { runCronJob } from "@/lib/monitoring/run-cron-job";

// Same host-agnostic trigger model as the other cron routes: any external
// scheduler hitting this on an interval, GET (Vercel Cron) or POST
// (manual/other schedulers), with the same CRON_SECRET bearer header.
//
// Scalability Track, Phase B: this route exists and is schedulable, but
// nothing in this codebase reads from analytics_daily_rollups yet (that is
// Phase D) — running it has zero effect on any current analytics page.
export const runtime = "nodejs";

function handle(request: Request): Promise<NextResponse> {
  return runCronJob(request, "analytics-rollup", (supabase) => runAnalyticsRollupWorker(supabase));
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
