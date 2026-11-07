import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

export async function getProfile(supabase: Client, userId: string) {
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

// One row per user: creates it on first use, otherwise updates it.
export async function upsertProfile(
  supabase: Client,
  userId: string,
  values: Omit<TablesInsert<"profiles">, "user_id">,
) {
  const result = await supabase
    .from("profiles")
    .upsert({ ...values, user_id: userId }, { onConflict: "user_id" })
    .select("*")
    .single();
  return unwrap<Tables<"profiles">>(result);
}

// Creates the user's profile from what they entered at sign-up (stored by
// Supabase Auth as user_metadata — see lib/actions/auth.ts's signUp) when
// no profile row exists yet. Insert-only: an existing profile, including
// one the user has since edited, is never overwritten. Returns the profile
// as it now stands.
export async function ensureProfileFromSignup(
  supabase: Client,
  userId: string,
  seed: { fullName: string | null; timezone: string | null },
) {
  const existing = await getProfile(supabase, userId);
  if (existing) return existing;
  if (!seed.fullName && !seed.timezone) return null;

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      full_name: seed.fullName,
      ...(seed.timezone ? { timezone: seed.timezone } : {}),
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (error) throw error;
  return getProfile(supabase, userId);
}
