"use client";

import { useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";

import type { BillingInterval, PaidPlanId } from "@/lib/billing/plans";
import { createCheckoutSessionAction } from "@/app/(app)/billing/actions";
import { Button } from "@/components/ui/button";

export function CheckoutButton({
  planId,
  interval,
  disabled,
  children,
}: {
  planId: PaidPlanId;
  interval: BillingInterval;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await createCheckoutSessionAction({ planId, interval });
      } catch (error) {
        // createCheckoutSessionAction ends in redirect(), which Next.js
        // implements by throwing an internal control-flow error — must be
        // rethrown, not treated as a real failure, or the redirect to
        // Stripe Checkout never happens. See the docs on unstable_rethrow.
        unstable_rethrow(error);
        toast.error(error instanceof Error ? error.message : "Couldn't start checkout. Try again.");
      }
    });
  }

  return (
    <Button onClick={handleClick} disabled={disabled || isPending} className="w-full">
      {isPending ? "Redirecting…" : children}
    </Button>
  );
}
