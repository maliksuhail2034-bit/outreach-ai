// Shared types for the deliverability foundation — DNS verification,
// scoring, and mailbox health. See dns-provider.ts for the DNS check
// abstraction and scoring.ts for how these combine into a health score.

export type DnsRecordType = "spf" | "dkim" | "dmarc" | "mx";

// 'pending' is the honest placeholder state before a real provider has run
// — see dns-providers/placeholder.ts. 'error' is a check that couldn't
// complete (network/provider failure), distinct from 'fail' (the check ran
// and the record is missing or misconfigured).
export type DnsCheckStatus = "pending" | "pass" | "fail" | "error";

export interface DnsCheckResult {
  recordType: DnsRecordType;
  status: DnsCheckStatus;
  detail: string | null;
}

export type WarmupStatus = "not_started" | "warming" | "warmed" | "paused";
