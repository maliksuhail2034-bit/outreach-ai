import type { DnsCheckResult } from "./types";

// Provider-agnostic contract for verifying a sending domain's SPF/DKIM/
// DMARC/MX records. Exactly one implementation exists today
// (PlaceholderDnsProvider, which performs no real lookups) — this interface
// exists so a live provider (a DNS-over-HTTPS resolver, a third-party
// deliverability API, etc.) can be swapped in later without touching any
// call site that only depends on this file. Mirrors
// lib/email/reply-provider.ts's split exactly.
export interface DnsProvider {
  verifyDomain(domain: string): Promise<DnsCheckResult[]>;
}
