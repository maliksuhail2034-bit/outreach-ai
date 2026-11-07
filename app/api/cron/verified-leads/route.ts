import type { NextResponse } from "next/server";
import { allocationDegraded, runVerifiedLeadAllocation } from "@/lib/verified-leads/allocation";
import { runCronJob } from "@/lib/monitoring/run-cron-job";

export const runtime = "nodejs";

// Daily verified-lead allocation (pg_cron, 03:20 UTC — see
// supabase/migrations/20261107100000_staff_console.sql). Same CRON_SECRET
// bearer check, job_runs record and heartbeat as every other cron route.
function handle(request: Request): Promise<NextResponse> {
  return runCronJob(request, "verified-leads", (supabase) => runVerifiedLeadAllocation(supabase), allocationDegraded);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
