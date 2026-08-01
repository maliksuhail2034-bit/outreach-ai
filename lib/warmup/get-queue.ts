import type { WarmupQueue } from "./queue";
import { NoOpWarmupQueue } from "./queues/no-op";

// One-line factory — the entire seam a real queue backend needs later,
// mirroring get-provider.ts. Nothing else in the app should construct a
// WarmupQueue directly.
export function getWarmupQueue(): WarmupQueue {
  return new NoOpWarmupQueue();
}
