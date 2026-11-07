import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { deleteLatestRateLimitAttempt, recordRateLimitAttempt } from "./rate-limit";

function createMockClient(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  const client = { rpc } as unknown as Client;
  return { client, rpc };
}

describe("recordRateLimitAttempt", () => {
  it("calls the RPC with the given scope/identity/window/max and returns the mapped result", async () => {
    const { client, rpc } = createMockClient({
      data: [{ allowed: true, retry_after_seconds: 0 }],
      error: null,
    });

    const result = await recordRateLimitAttempt(client, "auth:sign_in", "1.2.3.4", 900, 10);

    expect(rpc).toHaveBeenCalledWith("record_rate_limit_attempt", {
      p_scope: "auth:sign_in",
      p_identity: "1.2.3.4",
      p_window_seconds: 900,
      p_max_attempts: 10,
    });
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("maps a blocked result including retry_after_seconds", async () => {
    const { client } = createMockClient({
      data: [{ allowed: false, retry_after_seconds: 42 }],
      error: null,
    });

    const result = await recordRateLimitAttempt(client, "auth:sign_in", "1.2.3.4", 900, 10);

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("throws when the RPC errors", async () => {
    const { client } = createMockClient({ data: null, error: new Error("db unavailable") });

    await expect(recordRateLimitAttempt(client, "auth:sign_in", "1.2.3.4", 900, 10)).rejects.toThrow(
      "db unavailable",
    );
  });

  it("throws when the RPC returns no row", async () => {
    const { client } = createMockClient({ data: [], error: null });

    await expect(recordRateLimitAttempt(client, "auth:sign_in", "1.2.3.4", 900, 10)).rejects.toThrow(
      "record_rate_limit_attempt returned no row.",
    );
  });
});

describe("deleteLatestRateLimitAttempt", () => {
  // Minimal PostgREST double: records every call, returns `selectResult`
  // for the lookup and `deleteResult` for the delete.
  function fakeClient(selectResult: { data: unknown; error: unknown }, deleteResult: { error: unknown } = { error: null }) {
    const calls: string[] = [];
    const chain = (result: unknown) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push(`${method}(${args.map((a) => JSON.stringify(a)).join(",")})`);
          return builder;
        };
      }
      builder.maybeSingle = async () => result;
      builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
      return builder;
    };
    const client = {
      from: (table: string) => {
        calls.push(`from(${table})`);
        return {
          select: (columns: string) => {
            calls.push(`select(${columns})`);
            return chain(selectResult);
          },
          delete: () => {
            calls.push("delete()");
            return chain(deleteResult);
          },
        };
      },
    } as unknown as Client;
    return { client, calls };
  }

  it("deletes the newest attempt for exactly that scope and identity", async () => {
    const { client, calls } = fakeClient({ data: { id: "evt-newest" }, error: null });

    await expect(deleteLatestRateLimitAttempt(client, "auth:sign_in", "1.2.3.4")).resolves.toBe(true);

    expect(calls).toEqual([
      "from(rate_limit_events)",
      "select(id)",
      'eq("scope","auth:sign_in")',
      'eq("identity","1.2.3.4")',
      'order("created_at",{"ascending":false})',
      "limit(1)",
      "from(rate_limit_events)",
      "delete()",
      'eq("id","evt-newest")',
    ]);
  });

  it("does nothing when there is no attempt to remove", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });

    await expect(deleteLatestRateLimitAttempt(client, "auth:sign_in", "1.2.3.4")).resolves.toBe(false);
    expect(calls).not.toContain("delete()");
  });

  it("throws on a lookup or delete error so the caller's best-effort wrapper can log it", async () => {
    await expect(
      deleteLatestRateLimitAttempt(fakeClient({ data: null, error: new Error("lookup failed") }).client, "s", "i"),
    ).rejects.toThrow("lookup failed");
    await expect(
      deleteLatestRateLimitAttempt(fakeClient({ data: { id: "x" }, error: null }, { error: new Error("delete failed") }).client, "s", "i"),
    ).rejects.toThrow("delete failed");
  });
});
