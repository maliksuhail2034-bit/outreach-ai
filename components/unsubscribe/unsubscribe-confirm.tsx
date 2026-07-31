"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmUnsubscribeAction } from "@/app/unsubscribe/[token]/actions";
import type { UnsubscribeResult } from "@/lib/email/unsubscribe";

// GET renders this (see ../../../app/unsubscribe/[token]/page.tsx) but the
// actual mutation only happens on this button's click (a POST via the
// Server Function below) — deliberately not on page load. Some email
// clients prefetch/"safe-browsing"-scan links found in emails, which would
// silently unsubscribe someone if the GET request itself performed the
// mutation.
export function UnsubscribeConfirm({ token }: { token: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<UnsubscribeResult | null>(null);

  function handleClick() {
    startTransition(async () => {
      setResult(await confirmUnsubscribeAction(token));
    });
  }

  if (result?.ok) {
    return (
      <p className="text-sm text-muted-foreground">
        You&apos;ve been unsubscribed. You won&apos;t receive any more emails from this sender.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={handleClick} disabled={isPending}>
        {isPending ? "Unsubscribing…" : "Unsubscribe"}
      </Button>
      {result && !result.ok && <p className="text-sm text-destructive">{result.error}</p>}
    </div>
  );
}
