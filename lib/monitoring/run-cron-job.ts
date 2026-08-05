import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordJobRun } from "@/lib/db";
import type { Json } from "@/types/database.types";
import { pingHeartbeat, type CronJobName } from "./heartbeat";
import { captureError } from "./error-tracking";

// Same constant-time comparison already used for the unsubscribe token
// (lib/email/unsubscribe-token.ts) and OAuth state (app/api/oauth/*/callback/
// route.ts's isValidState) — timingSafeEqual throws on mismatched lengths
// rather than returning false, so length is checked first.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  if (expected.length !== provided.length) return false;

  return timingSafeEqual(expected, provided);
}

// Shared shell for all five cron routes (app/api/cron/*/route.ts) — before
// Phase 3A this exact auth-check/try-catch/logging shape was duplicated
// five times over; adding job_runs persistence, a heartbeat ping, and an
// error-tracking forward to each of those five copies individually would
// have meant six near-identical edits instead of one. The workers
// themselves stay fully separate (this only wraps the route-level
// boilerplate, never the worker orchestration) — same deliberate
// non-coupling reply-worker.ts's route already calls out.
export async function runCronJob<T extends object>(
  request: Request,
  job: CronJobName,
  run: () => Promise<T>,
): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logLabel = `[cron/${job}]`;
  const startedAtDate = new Date();
  const startedAt = startedAtDate.getTime();
  const supabase = createAdminClient();

  try {
    const summary = await run();
    const executionTimeMs = Date.now() - startedAt;

    // The only place a run's outcome was visible short of querying the DB
    // directly (see job_runs write below) — kept here too so it still shows
    // up in hosting/platform logs even if nothing reads the HTTP body or
    // the job_runs table.
    console.log(logLabel, JSON.stringify({ ...summary, executionTimeMs }));

    // Best-effort: persisting the run record must never fail the cron
    // response itself — the console.log above already preserved the
    // outcome even if this write fails.
    await recordJobRun(supabase, {
      job,
      status: "success",
      summary: summary as unknown as Json,
      error: null,
      duration_ms: executionTimeMs,
      started_at: startedAtDate.toISOString(),
    }).catch((dbError) => {
      console.error(logLabel, "failed to persist job_runs row", dbError);
    });

    await pingHeartbeat(job, "success");

    return NextResponse.json({ ...summary, executionTimeMs });
  } catch (error) {
    // Overlapping invocations are already safe for the claim-based workers
    // (claim_due_sends()/claim_send_attempt()/claim_due_verifications() do
    // the actual locking) — this catch only turns an unexpected error into
    // a structured response instead of an unhandled 500, it adds no
    // locking of its own.
    const executionTimeMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : "Unknown error running this job.";
    console.error(logLabel, JSON.stringify({ error: errorMessage, executionTimeMs }));

    await recordJobRun(supabase, {
      job,
      status: "error",
      summary: {},
      error: errorMessage,
      duration_ms: executionTimeMs,
      started_at: startedAtDate.toISOString(),
    }).catch((dbError) => {
      console.error(logLabel, "failed to persist job_runs row", dbError);
    });

    await pingHeartbeat(job, "fail");
    await captureError({ job, message: errorMessage });

    return NextResponse.json({ error: errorMessage, executionTimeMs }, { status: 500 });
  }
}
