import type { DnsProvider } from "./dns-provider";
import { PlaceholderDnsProvider } from "./dns-providers/placeholder";

// One-line factory — the entire seam a real DNS provider needs later,
// mirroring lib/email/get-reply-provider.ts exactly. Nothing else in the
// app should construct a DnsProvider directly.
export function getDnsProvider(): DnsProvider {
  return new PlaceholderDnsProvider();
}
