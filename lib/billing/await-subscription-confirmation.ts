// After Razorpay Checkout reports success in the browser, the plan only
// changes once the webhook has written the subscription — which can land a
// few seconds later. This polls the server for that confirmation instead of
// trusting the client-side success callback; the caller refreshes the page
// either way, so it never grants anything by itself.

export interface AwaitSubscriptionConfirmationOptions {
  checkStatus: () => Promise<{ confirmed: boolean }>;
  attempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function awaitSubscriptionConfirmation({
  checkStatus,
  attempts = 15,
  intervalMs = 2000,
  sleep = defaultSleep,
}: AwaitSubscriptionConfirmationOptions): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if ((await checkStatus()).confirmed) return true;
    } catch {
      // A transient failure of one poll shouldn't end the wait early.
    }
    if (attempt < attempts - 1) await sleep(intervalMs);
  }
  return false;
}
