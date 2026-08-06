import type { NextResponse } from "next/server";
import { runRetentionWorker } from "@/lib/monitoring/retention-worker";
import { runCronJob } from "@/lib/monitoring/run-cron-job";

// Same host-agnostic trigger model as the other cron routes: any external
// scheduler hitting this on an interval, GET (Vercel Cron) or POST
// (manual/other schedulers), with the same CRON_SECRET bearer header.
//
// Scalability Track, Phase D (item 11): runRetentionWorker() deletes for
// real — see lib/monitoring/retention-worker.ts for the cutover details.
export const runtime = "nodejs";

function handle(request: Request): Promise<NextResponse> {
  return runCronJob(request, "retention-cleanup", (supabase) => runRetentionWorker(supabase));
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
