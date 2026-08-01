"use client";

import { useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";

import { createPortalSessionAction } from "@/app/(app)/billing/actions";
import { Button } from "@/components/ui/button";

export function ManageSubscriptionButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await createPortalSessionAction();
      } catch (error) {
        // See CheckoutButton — createPortalSessionAction ends in redirect(),
        // which must be rethrown, not treated as a real failure.
        unstable_rethrow(error);
        toast.error(error instanceof Error ? error.message : "Couldn't open the billing portal. Try again.");
      }
    });
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={isPending}>
      {isPending ? "Opening…" : "Manage subscription"}
    </Button>
  );
}
