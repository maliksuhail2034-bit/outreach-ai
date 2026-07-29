import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

// Every function in lib/db/ takes this as its first argument instead of
// creating a client itself, so callers control which client (RLS-scoped
// server client vs. privileged admin client) and which request/session a
// query runs against.
export type Client = SupabaseClient<Database>;

// Throws on error, and on a single-row query that unexpectedly found no
// row, instead of forcing every caller to repeat the same two checks.
export function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw result.error;
  if (result.data === null) throw new Error("Expected a row, received none.");
  return result.data;
}
