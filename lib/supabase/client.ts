import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

// Browser-safe client: only ever touches NEXT_PUBLIC_ env vars, which Next.js
// inlines into the client bundle. Access is governed by Row Level Security.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
