import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { trustedClientIp } from "@/lib/rate-limit/get-client-ip";
import { isRequestIpBlocked } from "@/lib/security/ip-blocklist";
import { recordPageView } from "@/lib/traffic/record";

// Next.js 16 renamed Middleware to Proxy (same file-convention mechanics,
// new file name and export name) — see AGENTS.md and CLAUDE.md.
//
// This refreshes the Supabase auth session cookie on every matched request.
// Server Components can't write cookies, so without this, a session nearing
// expiry would eventually fail to refresh and silently log the user out.
// Route-level redirects (protected routes, auth-page redirects) still live
// in app/(app)/layout.tsx and app/(auth)/layout.tsx — this is session
// upkeep only, not the authorization boundary. See the Next.js Proxy docs:
// optimistic checks here are fine, but real authorization must happen
// close to the data (RLS, Server Function checks), not in Proxy.
// Supabase SSR stores the session as `sb-<project-ref>-auth-token` (split
// into `.0`, `.1`… chunks when large).
function hasSupabaseSession(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => name.startsWith("sb-") && /-auth-token(\.\d+)?$/.test(name));
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  // The security team's IP blocklist (lib/security/ip-blocklist.ts), checked
  // before anything else, signed in or not.
  if (await isRequestIpBlocked(trustedClientIp(request.headers), createAdminClient)) {
    return new NextResponse("Access from your network has been blocked. Contact support@polimatiq.com if you think this is a mistake.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const signedIn = hasSupabaseSession(request);

  // Cookieless page-load analytics for the staff console's Traffic page
  // (lib/traffic/page-view.ts decides what counts). Written after the
  // response is sent, so it never delays the page.
  event.waitUntil(recordPageView(request, signedIn));

  // Anonymous visitors (marketing, legal, login/signup pages) have no
  // session to refresh, so skip the round trip to Supabase Auth entirely.
  // That call used to run on every public page view, adding latency and an
  // Auth API request per visitor — the most traffic-sensitive path the app
  // has.
  if (!signedIn) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Must be called (not just cookies.getAll()) — this is what actually
  // talks to Supabase and rotates the token when it's close to expiry.
  await supabase.auth.getUser();

  return response;
}

// Machine-called API routes are excluded: pg_cron (api/cron), tracking
// pixels and clicks (api/track), provider webhooks (api/webhooks) and the
// uptime monitor (api/health) never carry a user session, so running Proxy
// for them only adds an invocation to every call. api/oauth is kept — its
// callbacks need the user's refreshed session.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron|api/track|api/webhooks|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
