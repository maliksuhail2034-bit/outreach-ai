"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const POLL_MS = 3000;

// The confirmation link opens in a new tab (browsers give a page no way to
// reuse an existing one). That tab's /auth/confirm visit sets the session
// cookie, which every tab on this origin shares — so this tab notices it
// and continues to the app on its own. Only a session for the account that
// just signed up counts — the cookie is shared, so it could belong to anyone
// who signed in on this browser.
export function AwaitEmailConfirmation({ email }: { email: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let done = false;

    async function check() {
      if (done) return;
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.email?.toLowerCase() === email.toLowerCase() && !done) {
        done = true;
        router.replace("/dashboard");
        router.refresh();
      }
    }

    const interval = window.setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      done = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router, email]);

  return (
    <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      Waiting for you to confirm your email…
    </p>
  );
}
