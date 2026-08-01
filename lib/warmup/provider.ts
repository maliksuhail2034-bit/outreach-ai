// Provider-agnostic contract for a future warmup network (a third-party
// warmup provider, a provider marketplace, a seed-inbox network). No
// implementation exists yet — see providers/placeholder.ts and Task 6's
// explicit scope: "DO NOT integrate with third-party warmup providers
// yet." This interface exists purely so that integration is additive
// later, mirroring lib/deliverability/dns-provider.ts's split exactly.
export interface WarmupProviderRunResult {
  // Whether the provider actually ran anything for this cycle — false is
  // the honest answer for every implementation today.
  ran: boolean;
  detail: string | null;
}

export interface WarmupProvider {
  runCycle(mailboxId: string): Promise<WarmupProviderRunResult>;
}
