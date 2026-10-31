import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

// Server Component / Route Handler / Server Action client, scoped to the
// signed-in user's session via cookies. Still uses the anon key, so Row
// Level Security policies apply — this is not a privilege-escalation path.
export async function createClient() {
  const cookieStore = await cookies();
  const userAgent = (await headers()).get("user-agent");

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Auth calls are made from this server, so without this Supabase
      // records every login session as "node" instead of the user's browser
      // (shown in Settings → Sessions).
      global: { headers: userAgent ? { "User-Agent": userAgent } : {} },
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
