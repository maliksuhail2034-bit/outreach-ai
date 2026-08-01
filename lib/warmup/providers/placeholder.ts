import type { WarmupProvider, WarmupProviderRunResult } from "../provider";

// No warmup network exists yet — this provider does nothing and says so.
// The only WarmupProvider implementation today; a real one (a third-party
// warmup network, or a provider selected from a future marketplace)
// implements this same interface and is returned from get-provider.ts
// instead — nothing else in the app changes.
export class PlaceholderWarmupProvider implements WarmupProvider {
  async runCycle(mailboxId: string): Promise<WarmupProviderRunResult> {
    return { ran: false, detail: `No warmup provider is configured yet for mailbox ${mailboxId}.` };
  }
}
