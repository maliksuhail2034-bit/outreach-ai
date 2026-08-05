import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Same runtime requirement as every other Route Handler in this codebase
// that touches Supabase server-side — kept consistent across the deployment
// target rather than left to the framework default.
export const runtime = "nodejs";

// Deliberately unauthenticated — an uptime monitor or load balancer needs
// to reach this without a distributed secret, unlike the cron routes (which
// trigger real work and stay behind CRON_SECRET). Returns no domain data,
// only whether the process is up and can reach its database.
export async function GET() {
  const startedAt = Date.now();

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("organizations").select("id").limit(1);
    if (error) throw error;

    return NextResponse.json({
      status: "ok",
      database: "ok",
      responseTimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error.";
    console.error("[health]", message);

    return NextResponse.json(
      {
        status: "error",
        database: "error",
        responseTimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
