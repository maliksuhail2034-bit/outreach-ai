import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/profiles";

// Returns the signed-in user for the current request, or null if there
// isn't one. Safe to call from any Server Component, Server Function, or
// Route Handler. Wrapped in React's cache() so the many Server Components
// that each independently call this per request (layout + nearly every
// nested page) share one supabase.auth.getUser() network round-trip
// instead of repeating it — cache() dedupes within a single render pass
// only, so this stays safe to call from a Server Function too (a separate
// invocation, never sharing a stale result with a page render).
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
});

// Same dedup as getUser() above, for the profiles row — app/(app)/layout.tsx
// (via components/shell/user-menu-data.tsx) and the Dashboard/Settings pages
// each independently need the signed-in user's profile within the same
// request; without this they issued two separate Postgres queries for the
// exact same row. Keyed only on userId (not a supabase client instance) so
// cache() can actually match calls from different call sites — mirrors
// getUser()'s own no-argument pattern of creating its client internally
// instead of accepting one, which is what makes the memoization key stable.
// Scoped to one render pass like getUser(), so this never leaks one user's
// profile into another user's request.
export const getCachedProfile = cache(async (userId: string) => {
  const supabase = await createClient();
  return getProfile(supabase, userId);
});

// Same as getUser(), but throws if there's no signed-in user. Server
// Functions and Route Handlers are reachable directly over the network, not
// just through the UI — call this first thing in every one that touches
// user-owned data instead of assuming the caller is authenticated.
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) {
    throw new Error("Unauthorized: no authenticated user.");
  }
  return user;
}
