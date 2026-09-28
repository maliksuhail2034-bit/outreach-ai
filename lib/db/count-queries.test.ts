import { describe, expect, it, vi } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { CountQueryError, countOrThrow, type Client } from "./shared";
import { isTransientError } from "./resilient-read";
import { countLeads } from "./leads";
import { countMailboxes } from "./mailboxes";
import { countEmailEventsByType } from "./email-events";
import { countSendAttemptsByStatus } from "./send-attempts";
import { getCampaignLeadActivitySummary } from "./campaign-leads";

type CountResult = { data: null; count: number | null; error: unknown; status: number; statusText: string };

// What postgrest-js returns for a failed count (HEAD) request: a HEAD
// response never has a body, so the error is a bare { message: "" }.
function bodyless(status: number, statusText: string): CountResult {
  return { data: null, count: null, error: { message: "" }, status, statusText };
}
function counted(count: number | null): CountResult {
  return { data: null, count, error: null, status: 200, statusText: "OK" };
}
const JWT_EXPIRED = { code: "PGRST303", details: null, hint: null, message: "JWT expired" };

// Every from() call gets its own chain resolving to the next queued result
// (getCampaignLeadActivitySummary makes three queries; the count is first).
function createMockClient(...results: unknown[]) {
  const queue = [...results];
  const from = vi.fn(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void) => resolve(result),
    };
    for (const method of ["select", "eq", "not", "order", "limit", "maybeSingle"]) {
      chain[method] = vi.fn(() => chain);
    }
    return chain;
  });
  return { from } as unknown as Client;
}

describe("countOrThrow", () => {
  it("turns a bodyless 503 into a real Error with a non-empty message and the status", () => {
    let thrown: unknown;
    try {
      countOrThrow(bodyless(503, "Service Unavailable") as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CountQueryError);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as CountQueryError).message).toBe("Count query failed (HTTP 503 Service Unavailable).");
    expect((thrown as CountQueryError).status).toBe(503);
  });

  it("keeps the message non-empty when the response has no status text", () => {
    expect(() => countOrThrow(bodyless(502, "") as never)).toThrow("Count query failed (HTTP 502).");
  });

  it("throws a coded PostgREST error unchanged", () => {
    const error = { ...JWT_EXPIRED } as unknown as PostgrestError;
    let thrown: unknown;
    try {
      countOrThrow({ count: null, error, status: 401, statusText: "Unauthorized" });
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(error);
  });

  it("throws a network failure (postgrest-js's code: \"\" error) unchanged", () => {
    const error = { code: "", details: "", hint: "", message: "TypeError: fetch failed" } as unknown as PostgrestError;
    let thrown: unknown;
    try {
      countOrThrow({ count: null, error, status: 0, statusText: "" });
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(error);
  });

  it("returns the count, and 0 for a zero or missing count", () => {
    expect(countOrThrow({ count: 12, error: null, status: 200, statusText: "OK" })).toBe(12);
    expect(countOrThrow({ count: 0, error: null, status: 200, statusText: "OK" })).toBe(0);
    expect(countOrThrow({ count: null, error: null, status: 200, statusText: "OK" })).toBe(0);
  });
});

// The dashboard's count reads (app/(app)/dashboard/page.tsx) — each goes
// through countOrThrow.
describe.each([
  ["countLeads", (client: Client) => countLeads(client, "user-1")],
  ["countMailboxes", (client: Client) => countMailboxes(client, "user-1")],
  ["countEmailEventsByType", (client: Client) => countEmailEventsByType(client, "sent")],
  ["countSendAttemptsByStatus", (client: Client) => countSendAttemptsByStatus(client, "failed")],
  [
    "getCampaignLeadActivitySummary (leadsCount)",
    (client: Client) => getCampaignLeadActivitySummary(client, "campaign-1").then((summary) => summary.leadsCount),
  ],
])("%s", (_name, run) => {
  it("classifies a bodyless 503 as a transient CountQueryError", async () => {
    const error = await run(createMockClient(bodyless(503, "Service Unavailable"))).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CountQueryError);
    expect((error as CountQueryError).status).toBe(503);
    expect(isTransientError(error)).toBe(true);
  });

  it("throws a non-empty, non-transient error for a bodyless 401", async () => {
    const error = await run(createMockClient(bodyless(401, "Unauthorized"))).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toBe("Count query failed (HTTP 401 Unauthorized).");
    expect(isTransientError(error)).toBe(false);
  });

  it("still throws a coded PostgREST error unchanged", async () => {
    const error = { ...JWT_EXPIRED };
    await expect(run(createMockClient({ data: null, count: null, error, status: 401, statusText: "Unauthorized" }))).rejects.toBe(
      error,
    );
  });

  it("returns 0 for zero rows (a new or empty account)", async () => {
    expect(await run(createMockClient(counted(0)))).toBe(0);
  });

  it("returns the count unchanged on success", async () => {
    expect(await run(createMockClient(counted(42)))).toBe(42);
  });
});

describe("getCampaignLeadActivitySummary", () => {
  it("returns the unchanged empty summary for a campaign with no leads", async () => {
    const client = createMockClient(counted(0), { data: null, error: null }, { data: null, error: null });
    expect(await getCampaignLeadActivitySummary(client, "campaign-1")).toEqual({
      leadsCount: 0,
      nextSendAt: null,
      lastActivityAt: null,
    });
  });

  it("still throws the timestamp lookups' errors unchanged", async () => {
    const error = { code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" };
    const client = createMockClient(counted(3), { data: null, error }, { data: null, error: null });
    await expect(getCampaignLeadActivitySummary(client, "campaign-1")).rejects.toBe(error);
  });
});
