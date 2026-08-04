import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { buildMicrosoftAuthUrl } from "@/lib/email/microsoft-oauth";

// Route Handler, not a Server Function — this needs to redirect the
// top-level browser to Microsoft's own domain. Mirrors
// app/api/oauth/google/start/route.ts exactly.

export const STATE_COOKIE_NAME = "microsoft_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes — just long enough for the round trip to Microsoft and back

// requireUser() throws for an unauthenticated request; app/(app)/layout.tsx
// already gates the /mailboxes page this link starts from, but Route
// Handlers are reachable directly, so this re-checks independently.
export async function GET() {
  await requireUser();

  // A random, unguessable value stored in a cookie only this browser can
  // read back (httpOnly) and only over this flow's short lifetime — the
  // standard OAuth "state cookie" CSRF defense, identical to the Google
  // flow's.
  const state = randomBytes(24).toString("base64url");

  const response = NextResponse.redirect(buildMicrosoftAuthUrl(state));
  response.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: "/api/oauth/microsoft",
  });
  return response;
}
