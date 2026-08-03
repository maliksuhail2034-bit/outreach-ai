import { NextResponse } from "next/server";
import { runDeliverabilityHealthCheckWorker } from "@/lib/deliverability/health-check-worker";

// Same host-agnostic trigger model as the other cron routes (send-emails,
// sync-replies): any external scheduler hitting this on an interval, GET
// (Vercel Cron) or POST (manual/other schedulers), with the same
// CRON_SECRET bearer header.
//
// Unlike send-emails/sync-replies, nothing here needs raw TCP sockets — the
// worker only talks to Supabase over HTTP — but this is pinned to Node.js
// anyway to keep the deployment target consistent across every cron route.
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
    const summary = await runDeliverabilityHealthCheckWorker();
    console.log(
      "[cron/deliverability-health-check]",
      JSON.stringify({ ...summary, executionTimeMs: Date.now() - startedAt }),
    );
    return NextResponse.json({ ...summary, executionTimeMs: Date.now() - startedAt });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error running the health check worker.";
    console.error(
      "[cron/deliverability-health-check]",
      JSON.stringify({ error: errorMessage, executionTimeMs: Date.now() - startedAt }),
    );
    return NextResponse.json({ error: errorMessage, executionTimeMs: Date.now() - startedAt }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
