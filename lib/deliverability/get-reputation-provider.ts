import type { ReputationProvider } from "./reputation-provider";
import { PlaceholderReputationProvider } from "./reputation-providers/placeholder";

// One-line factory — the entire seam a real reputation provider needs
// later, mirroring lib/deliverability/get-dns-provider.ts exactly. Nothing
// else in the app should construct a ReputationProvider directly.
export function getReputationProvider(): ReputationProvider {
  return new PlaceholderReputationProvider();
}
