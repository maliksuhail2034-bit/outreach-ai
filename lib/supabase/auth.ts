import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Returns the signed-in user for the current request, or null if there
// isn't one. Safe to call from any Server Component, Server Function, or
// Route Handler.
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

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
