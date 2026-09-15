import { describe, expect, it, vi } from "vitest";
import {
  anyFailed,
  firstError,
  isNotFoundError,
  isTransientError,
  optionalRead,
  withRetry,
} from "./resilient-read";

function postgrestError(code: string, message = "db error"): { code: string; message: string; details: string; hint: string } {
  return { code, message, details: "", hint: "" };
}

describe("isTransientError", () => {
  it("treats a Postgres connection-exception (class 08) as transient", () => {
    expect(isTransientError(postgrestError("08006"))).toBe(true);
  });

  it("treats a Postgres operator-intervention error (class 57, e.g. statement timeout) as transient", () => {
    expect(isTransientError(postgrestError("57014"))).toBe(true);
  });

  it("treats a raw TypeError (e.g. undici's 'fetch failed') as transient", () => {
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
  });

  it("treats an AbortError as transient", () => {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    expect(isTransientError(error)).toBe(true);
  });

  it("does not treat a PostgREST application error (e.g. missing table) as transient", () => {
    expect(isTransientError(postgrestError("PGRST205"))).toBe(false);
  });

  it("does not treat a real constraint violation (class 23) as transient", () => {
    expect(isTransientError(postgrestError("23505"))).toBe(false);
  });

  it("does not treat a not-found error as transient", () => {
    expect(isTransientError(postgrestError("PGRST116"))).toBe(false);
  });

  it("does not treat a plain application Error as transient", () => {
    expect(isTransientError(new Error("Expected a row, received none."))).toBe(false);
  });
});

describe("isNotFoundError", () => {
  it("recognizes PGRST116", () => {
    expect(isNotFoundError(postgrestError("PGRST116"))).toBe(true);
  });

  it("rejects other codes", () => {
    expect(isNotFoundError(postgrestError("PGRST205"))).toBe(false);
    expect(isNotFoundError(new Error("no rows"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result immediately on success — existing successful behavior is unchanged", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(fn, { baseDelayMs: 0 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and succeeds once the underlying call recovers", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, { baseDelayMs: 0 });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries and rethrows the last transient error", async () => {
    const error = new TypeError("fetch failed");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { retries: 2, baseDelayMs: 0 })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries — bounded, not a retry storm
  });

  it("does not retry a non-transient application error", async () => {
    const error = postgrestError("PGRST205");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { baseDelayMs: 0 })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry an authorization-shaped error", async () => {
    // RLS-driven access failures don't come back through PostgREST as a
    // distinct "denied" code (a denied row is just filtered out), but any
    // other PostgREST-shaped error (e.g. a JWT problem, PGRST301) must never
    // be retried or hidden either.
    const error = postgrestError("PGRST301", "JWT expired");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { baseDelayMs: 0 })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("optionalRead", () => {
  it("returns the real data with failed: false on success", async () => {
    const result = await optionalRead(async () => ["a", "b"], [] as string[], { baseDelayMs: 0 });

    expect(result).toEqual({ data: ["a", "b"], failed: false });
  });

  it("falls back to the provided default after transient retries are exhausted, without throwing", async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await optionalRead(fn, [] as string[], { retries: 1, baseDelayMs: 0 });

    expect(result.failed).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.error).toBeInstanceOf(TypeError);
  });

  it("still throws a genuine (non-transient) application/data error instead of swallowing it", async () => {
    const error = postgrestError("PGRST205");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(optionalRead(fn, [] as string[], { baseDelayMs: 0 })).rejects.toBe(error);
  });

  it("does not swallow an authorization/permission failure as an empty state", async () => {
    const error = postgrestError("PGRST301", "JWT expired");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(optionalRead(fn, [] as string[], { baseDelayMs: 0 })).rejects.toBe(error);
  });

  it("one optional query failing does not affect a sibling optional query succeeding", async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const succeeding = vi.fn().mockResolvedValue(["ok"]);

    const [a, b] = await Promise.all([
      optionalRead(failing, [] as string[], { retries: 1, baseDelayMs: 0 }),
      optionalRead(succeeding, [] as string[], { retries: 1, baseDelayMs: 0 }),
    ]);

    expect(a).toEqual({ data: [], failed: true, error: expect.any(TypeError) });
    expect(b).toEqual({ data: ["ok"], failed: false });
  });
});

describe("anyFailed / firstError", () => {
  it("anyFailed is false when nothing failed", () => {
    expect(anyFailed({ failed: false }, { failed: false })).toBe(false);
  });

  it("anyFailed is true when any result failed", () => {
    expect(anyFailed({ failed: false }, { failed: true })).toBe(true);
  });

  it("firstError returns the first failed result's error", () => {
    const error = new Error("boom");
    expect(firstError({ failed: false, error: undefined }, { failed: true, error })).toBe(error);
  });

  it("firstError returns undefined when nothing failed", () => {
    expect(firstError({ failed: false }, { failed: false })).toBeUndefined();
  });
});
