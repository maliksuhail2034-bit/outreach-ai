import type { WarmupProvider } from "./provider";
import { PlaceholderWarmupProvider } from "./providers/placeholder";

// One-line factory — the entire seam a real warmup provider needs later,
// mirroring lib/deliverability/get-dns-provider.ts exactly. Nothing else in
// the app should construct a WarmupProvider directly.
export function getWarmupProvider(): WarmupProvider {
  return new PlaceholderWarmupProvider();
}
