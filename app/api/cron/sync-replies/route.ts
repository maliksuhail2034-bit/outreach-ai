import { NextResponse } from "next/server";
import { runReplySyncWorker } from "@/lib/email/reply-worker";

// Separate route, separate worker, from app/api/cron/send-emails/route.ts —
// deliberately not sharing code with it (see the reply-tracking plan's note
// on this tradeoff), so nothing here can affect the send pipeline. Same
// host-agnostic trigger model: any external scheduler hitting this on an
// interval, GET (Vercel Cron) or POST (manual/other schedulers) with the
// same CRON_SECRET bearer header.
//
// imapflow/mailparser need real TCP sockets and Node APIs, same reasoning
// as the send route — this must run on Node.js, not the edge runtime.
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
    const summary = await runReplySyncWorker();
    return NextResponse.json({ ...summary, executionTimeMs: Date.now() - startedAt });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error running the reply sync worker.",
        executionTimeMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
