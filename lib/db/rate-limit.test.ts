import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { recordRateLimitAttempt } from "./rate-limit";

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
