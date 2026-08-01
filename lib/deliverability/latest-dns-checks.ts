import type { Tables } from "@/types/database.types";
import type { DnsRecordType } from "./types";

type DomainDnsCheckRow = Tables<"domain_dns_checks">;

// Reduces a domain's DNS check history (several rows per record type,
// accumulated over repeated checks) down to the single most recent check
// per record type — what the Domain Health UI actually displays. Pure
// function, no I/O: lib/db/deliverability.ts fetches the rows ordered
// newest-first, this just picks the first one seen per record type.
export function latestDnsChecksByType(
  checks: DomainDnsCheckRow[],
): Partial<Record<DnsRecordType, DomainDnsCheckRow>> {
  const latest: Partial<Record<DnsRecordType, DomainDnsCheckRow>> = {};
  for (const check of checks) {
    const recordType = check.record_type as DnsRecordType;
    if (!latest[recordType]) latest[recordType] = check;
  }
  return latest;
}
