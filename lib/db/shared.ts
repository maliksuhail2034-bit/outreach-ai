import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

// Every function in lib/db/ takes this as its first argument instead of
// creating a client itself, so callers control which client (RLS-scoped
// server client vs. privileged admin client) and which request/session a
// query runs against.
export type Client = SupabaseClient<Database>;

// Throws on error, and on a single-row query that unexpectedly found no
// row, instead of forcing every caller to repeat the same two checks.
export function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw result.error;
  if (result.data === null) throw new Error("Expected a row, received none.");
  return result.data;
}

// PostgREST returns at most `max_rows` rows per request (1000 — see
// supabase/config.toml, the same default as a hosted project) and silently
// truncates anything larger, whatever `.limit()` asks for. A read that needs
// every matching row — a dedup set, a bulk enrollment — pages through with
// `.range()` instead. `fetchPage` must apply a total order (a unique
// tiebreaker such as `id`) so rows can't shift between pages.
export const POSTGREST_PAGE_SIZE = 1000;

export async function selectAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  limit = Number.POSITIVE_INFINITY,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < limit) {
    const from = rows.length;
    const to = Math.min(from + POSTGREST_PAGE_SIZE, limit) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return rows;
}

// Splits a list for `.in()` filters: every value goes into the request URL,
// so an unbounded list (thousands of emails or ids) makes the URL too long
// for the API gateway to accept.
export const EMAIL_LOOKUP_CHUNK = 100;

export function chunkValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return chunks;
}

// A count query ({ count: "exact", head: true }) is an HTTP HEAD request,
// whose response never has a body — so postgrest-js reports every failed
// one, whatever the cause, as a bare { message: "" } with no code, and a
// thrown plain object with an empty message is all that's left (the
// dashboard's intermittent `Error: {"message":""}`). The HTTP status is the
// only signal that survives; this keeps it, so isTransientError
// (lib/db/resilient-read.ts) can tell a transient 5xx from a real 401/403.
export class CountQueryError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Count query failed (HTTP ${status}${statusText ? ` ${statusText}` : ""}).`);
    this.name = "CountQueryError";
    this.status = status;
  }
}

// The count, or throws. Only the bodyless failure (postgrest-js's
// `{ message: body }`, which has no code at all) becomes a CountQueryError;
// a PostgREST error that did carry a code, and a network failure (code ""),
// are thrown unchanged.
export function countOrThrow(result: {
  count: number | null;
  error: PostgrestError | null;
  status: number;
  statusText: string;
}): number {
  if (result.error) {
    if (!("code" in result.error)) throw new CountQueryError(result.status, result.statusText);
    throw result.error;
  }
  return result.count ?? 0;
}
