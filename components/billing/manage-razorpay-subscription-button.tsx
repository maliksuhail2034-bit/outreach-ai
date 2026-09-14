"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cancelRazorpaySubscriptionAction } from "@/app/(app)/billing/razorpay-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Razorpay's counterpart to ManageSubscriptionButton (Stripe) — Razorpay has
// no hosted customer portal to redirect to, so this cancels directly through
// cancelRazorpaySubscriptionAction instead, gated behind the same
// confirm-dialog pattern components/campaigns/campaign-execution-controls.tsx
// already uses for its own destructive "Stop campaign" action. Cancellation
// is immediate (see the action's own comment for why "at period end" isn't
// offered), so this dialog says so plainly rather than implying otherwise.
export function ManageRazorpaySubscriptionButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function handleCancel() {
    startTransition(async () => {
      try {
        await cancelRazorpaySubscriptionAction();
        toast.success("Subscription cancelled.");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't cancel the subscription.");
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={isPending}>
        Cancel subscription
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel your subscription?</DialogTitle>
            <DialogDescription>
              This cancels your subscription immediately — access to paid features ends right away, not at the end
              of your current billing period. You can resubscribe any time from the Billing page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Keep subscription
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={isPending}>
              {isPending ? "Cancelling…" : "Cancel subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
