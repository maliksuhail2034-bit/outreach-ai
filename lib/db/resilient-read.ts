import type { PostgrestError } from "@supabase/supabase-js";

// Bounded resilience helpers for READ paths only — see app/(app)/dashboard/
// page.tsx and app/(app)/campaigns/[campaignId]/page.tsx, whose large
// Promise.all fan-outs (9 and 11 concurrent Supabase calls respectively)
// previously failed the entire page render on a single transient
// Supabase/PostgREST/network hiccup, surfacing as the generic
// "Something went wrong loading this page" boundary. NEVER wrap a mutation
// with these: retrying a write risks double-applying it, which reads never
// risk.

function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "details" in error &&
    "hint" in error
  );
}

// Postgres SQLSTATE class 08 (connection exception) and 57 (operator
// intervention — e.g. 57014 query_canceled from a statement timeout) are the
// only PostgREST-forwarded codes that represent the database connection
// itself being transiently unavailable, not the query being wrong. Every
// other code with this shape — PostgREST's own PGRST* codes (missing
// table/column, no rows, JWT problems, ...) and every other Postgres class
// (22 data exception, 23 constraint violation, 42 syntax/access-rule, ...)
// is a real application/data/authorization error and must never be retried
// or hidden. See https://www.postgresql.org/docs/current/errcodes-appendix.html.
const TRANSIENT_POSTGRES_CLASSES = new Set(["08", "57"]);

// A bare thrown Error with no PostgREST shape at all is what a network-level
// failure between the Vercel Function and Supabase looks like: Node's
// undici throws `TypeError: fetch failed` (sometimes with an empty
// message — see the production digest this fix responds to), and an
// AbortController timeout throws a DOMException named "AbortError". A real
// programming bug (e.g. a TypeError from bad code in this repo) also matches
// `instanceof TypeError`, but such a bug is deterministic, not intermittent —
// retrying it a couple of times costs at most a few hundred ms and then it
// still surfaces via the normal, un-swallowed error path.
export function isTransientError(error: unknown): boolean {
  if (isPostgrestError(error)) {
    return TRANSIENT_POSTGRES_CLASSES.has(error.code.slice(0, 2));
  }
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

// PostgREST's code for ".single()/.maybeSingle() found no matching row" (or,
// for .single(), "found more than one") — a real "not found," never
// transient, never retried.
export function isNotFoundError(error: unknown): boolean {
  return isPostgrestError(error) && error.code === "PGRST116";
}

export interface RetryOptions {
  /** Additional attempts after the first, only for transient errors. Default 2 (3 attempts total). */
  retries?: number;
  /** Backoff base, multiplied by attempt number (1, 2, 3, ...). Default 150ms. */
  baseDelayMs?: number;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries `fn` only when the error it threw is transient, with linear
// backoff, bounded by `retries` — never unbounded, never a retry storm (at
// most `retries` extra attempts, each further apart than the last). A
// non-transient error (a real application/data bug, an authorization
// failure, "not found") is rethrown immediately on the very first attempt,
// with no delay and no retry — this function only ever adds latency to the
// transient-failure path, never to the already-fast failure path of a real
// error.
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientError(error) || attempt >= retries) throw error;
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
}

export interface OptionalReadResult<T> {
  data: T;
  failed: boolean;
  error?: unknown;
}

// For a widget-scoped, non-critical read: retries transient failures via
// withRetry, and if still failing afterward, resolves to `fallback` with
// `failed: true` instead of rejecting — so one flaky optional query can no
// longer take down the whole page. A non-transient error (a real
// application/data bug or an authorization failure) is never caught here —
// it propagates exactly as the un-wrapped call would have, so a genuine bug
// still surfaces instead of silently rendering as empty/legitimate data.
// Callers that gate UI on `failed` (e.g. via ThrowIfFailed inside a
// WidgetErrorBoundary) keep a real failure visually distinct from a
// legitimately empty result.
export async function optionalRead<T>(
  fn: () => Promise<T>,
  fallback: T,
  options?: RetryOptions,
): Promise<OptionalReadResult<T>> {
  try {
    const data = await withRetry(fn, options);
    return { data, failed: false };
  } catch (error) {
    if (!isTransientError(error)) throw error;
    return { data: fallback, failed: true, error };
  }
}

// True if any of the given results failed — a terse way to gate a widget
// that depends on more than one optional read (e.g. "show the couldn't-load
// state if any of these three fetches failed").
export function anyFailed(...results: Pick<OptionalReadResult<unknown>, "failed">[]): boolean {
  return results.some((result) => result.failed);
}

// The first failure's error among the given results, or undefined — for
// passing a real, specific error into ThrowIfFailed instead of a generic one.
export function firstError(...results: Pick<OptionalReadResult<unknown>, "failed" | "error">[]): unknown {
  return results.find((result) => result.failed)?.error;
}
