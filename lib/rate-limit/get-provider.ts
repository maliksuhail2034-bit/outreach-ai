import type { RateLimiter } from "./provider";
import { PostgresRateLimiter } from "./providers/postgres";

// The one place that decides which RateLimiter implementation is in use —
// every caller depends only on this function and the RateLimiter interface,
// never on PostgresRateLimiter directly. Swapping in a distributed limiter
// later means one change here, not a change to any of check-rate-limit.ts's
// callers — mirrors getEmailProvider()/getIntegrationProvider() exactly.
export function getRateLimiter(): RateLimiter {
  return new PostgresRateLimiter();
}
