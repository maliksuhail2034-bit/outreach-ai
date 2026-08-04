import { NextResponse } from "next/server";
import { runVerificationWorker } from "@/lib/verification/bulk-worker";

// Same host-agnostic trigger model as the other cron routes (send-emails,
// sync-replies, deliverability-health-check, integrations-digest): any
// external scheduler hitting this on an interval, GET (Vercel Cron) or POST
// (manual/other schedulers), with the same CRON_SECRET bearer header.
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
    const summary = await runVerificationWorker();
    console.log("[cron/verify-leads]", JSON.stringify({ ...summary, executionTimeMs: Date.now() - startedAt }));
    return NextResponse.json({ ...summary, executionTimeMs: Date.now() - startedAt });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error running the verification worker.";
    console.error("[cron/verify-leads]", JSON.stringify({ error: errorMessage, executionTimeMs: Date.now() - startedAt }));
    return NextResponse.json({ error: errorMessage, executionTimeMs: Date.now() - startedAt }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
