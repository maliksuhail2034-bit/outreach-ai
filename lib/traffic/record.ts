import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { countryFromHeaders } from "@/lib/billing/region";
import { trustedClientIp } from "@/lib/rate-limit/get-client-ip";
import { buildPageView } from "./page-view";

const ERROR_LOG_INTERVAL_MS = 60_000;
let lastErrorLoggedAt = 0;

function ownHost(fallback: string): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").hostname || fallback;
  } catch {
    return fallback;
  }
}

// Called from proxy.ts through event.waitUntil, after the response is sent:
// never delays a page and never throws. A failed write is logged at most
// once a minute (analytics must not flood the logs during a database blip).
export async function recordPageView(request: NextRequest, signedIn: boolean): Promise<void> {
  try {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const row = buildPageView({
      method: request.method,
      url: request.nextUrl,
      headers: request.headers,
      ip: trustedClientIp(request.headers),
      country: countryFromHeaders(request.headers),
      signedIn,
      secret,
      ownHost: ownHost(request.nextUrl.hostname),
    });
    if (!row) return;
    const { error } = await createAdminClient().from("page_views").insert(row);
    if (error) throw error;
  } catch (error) {
    const now = Date.now();
    if (now - lastErrorLoggedAt > ERROR_LOG_INTERVAL_MS) {
      lastErrorLoggedAt = now;
      console.error("[traffic] page view not recorded", error instanceof Error ? error.message : error);
    }
  }
}
