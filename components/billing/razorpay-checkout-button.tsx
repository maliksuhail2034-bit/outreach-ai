"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { BillingInterval, PaidPlanId } from "@/lib/billing/plans";
import { createRazorpaySubscriptionAction } from "@/app/(app)/billing/razorpay-actions";
import { Button } from "@/components/ui/button";

const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
const CHECKOUT_SCRIPT_ID = "razorpay-checkout-js";

// checkout.js's real shape is much larger than this — narrowed to only
// what this component actually passes/reads, the same "isolate unsafe
// typing at the SDK boundary" approach lib/billing/sync-subscription-v2.ts
// takes server-side for the webhook payload. Kept local (not a global
// ambient .d.ts) since nothing else in the app touches this script.
interface RazorpayCheckoutOptions {
  key: string;
  subscription_id: string;
  name: string;
  prefill?: { email?: string };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayCheckoutInstance {
  open: () => void;
}
interface RazorpayCheckoutConstructor {
  new (options: RazorpayCheckoutOptions): RazorpayCheckoutInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayCheckoutConstructor;
  }
}

// Avoids injecting a second <script> tag if this component (or another
// instance of it) already triggered a load — checkout.js has no module
// export to just `import`, so a global script-id check is the standard way
// to dedupe this.
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();

  const existing = document.getElementById(CHECKOUT_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay checkout.")));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = CHECKOUT_SCRIPT_ID;
    script.src = CHECKOUT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout."));
    document.body.appendChild(script);
  });
}

// Separate from components/billing/checkout-button.tsx (Stripe) by design —
// the two providers' checkout mechanics genuinely differ (a server redirect
// vs. a client-side modal that needs a subscription_id up front), so this
// is a new component rather than a variant of the existing one. Does not
// use unstable_rethrow the way CheckoutButton does: that Stripe component
// needs it because createCheckoutSessionAction ends in redirect(); this
// component's server action returns data instead, so there's no
// Next.js-internal redirect error to special-case.
export function RazorpayCheckoutButton({
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
  // Tracks the window between "checkout requested" and "modal
  // dismissed/completed/errored" — broader than isPending (which only
  // covers the server action round-trip) so the button stays disabled
  // through script loading and while the modal itself is open, guarding
  // against a second click opening a second modal/subscription.
  const [isOpening, setIsOpening] = useState(false);

  function handleClick() {
    if (isPending || isOpening) return;

    startTransition(async () => {
      setIsOpening(true);
      try {
        const { subscriptionId, prefillEmail } = await createRazorpaySubscriptionAction({ planId, interval });

        const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
        if (!keyId) {
          throw new Error("Checkout is temporarily unavailable. Try again shortly or contact support.");
        }

        await loadCheckoutScript();
        if (!window.Razorpay) {
          throw new Error("Couldn't load checkout. Try again.");
        }

        const checkout = new window.Razorpay({
          key: keyId,
          subscription_id: subscriptionId,
          name: "Polimatiq",
          prefill: { email: prefillEmail },
          // Informational only — see lib/billing/sync-subscription-v2.ts
          // and app/api/webhooks/razorpay/route.ts. The webhook, not this
          // callback, is what confirms and writes billing state; this is
          // just a UX signal that the authentication step completed. No
          // database write happens here.
          handler: () => {
            toast.success("Payment submitted — your plan will update once confirmed.");
            setIsOpening(false);
          },
          modal: {
            ondismiss: () => setIsOpening(false),
          },
        });
        checkout.open();
      } catch (error) {
        setIsOpening(false);
        toast.error(error instanceof Error ? error.message : "Couldn't start checkout. Try again.");
      }
    });
  }

  return (
    <Button onClick={handleClick} disabled={disabled || isPending || isOpening} className="w-full">
      {isPending ? "Preparing checkout…" : isOpening ? "Opening…" : children}
    </Button>
  );
}
