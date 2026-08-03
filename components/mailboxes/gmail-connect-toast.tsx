"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// One-shot feedback for the redirect app/api/oauth/google/callback/route.ts
// lands on — a Server Component page reads the query params and passes
// them down as plain props rather than this component re-parsing the URL,
// matching how the rest of this app passes server-known values as props.
// Clears the query string after showing the toast so a page refresh
// doesn't re-fire it.
export function GmailConnectToast({ connected, error }: { connected?: string; error?: string }) {
  const router = useRouter();

  useEffect(() => {
    if (connected === "gmail") {
      toast.success("Gmail account connected.");
      router.replace("/mailboxes");
    } else if (error) {
      toast.error(error);
      router.replace("/mailboxes");
    }
  }, [connected, error, router]);

  return null;
}
