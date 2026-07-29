import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

// Server Component / Route Handler / Server Action client, scoped to the
// signed-in user's session via cookies. Still uses the anon key, so Row
// Level Security policies apply — this is not a privilege-escalation path.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `set` was called from a Server Component during render, which
            // is a no-op if session-refreshing middleware is in place.
          }
        },
      },
    },
  );
}
