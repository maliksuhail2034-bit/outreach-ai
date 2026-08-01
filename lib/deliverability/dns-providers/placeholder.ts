import type { DnsProvider } from "../dns-provider";
import type { DnsCheckResult, DnsRecordType } from "../types";

const RECORD_TYPES: DnsRecordType[] = ["spf", "dkim", "dmarc", "mx"];

// Performs no network lookups — every record type comes back 'pending'.
// This is the only DnsProvider implementation today; a live provider (real
// SPF/DKIM/DMARC/MX resolution, or a third-party deliverability API) is a
// future feature that only needs to implement this same interface and be
// returned from get-dns-provider.ts — nothing else in the app changes.
export class PlaceholderDnsProvider implements DnsProvider {
  async verifyDomain(domain: string): Promise<DnsCheckResult[]> {
    return RECORD_TYPES.map((recordType) => ({
      recordType,
      status: "pending",
      detail: `Live ${recordType.toUpperCase()} verification isn't configured yet for ${domain}.`,
    }));
  }
}
