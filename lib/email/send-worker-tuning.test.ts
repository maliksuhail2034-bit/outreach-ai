import { describe, expect, it, vi } from "vitest";

import { createSendRunCache, resolveWorkerTuning } from "./send-worker";

describe("resolveWorkerTuning", () => {
  it("defaults to 100 claims and 10 lanes", () => {
    expect(resolveWorkerTuning({})).toEqual({ limit: 100, concurrency: 10 });
  });

  it("honours valid overrides and clamps them to safe bounds", () => {
    expect(resolveWorkerTuning({ SEND_WORKER_CLAIM_LIMIT: "250", SEND_WORKER_CONCURRENCY: "20" })).toEqual({ limit: 250, concurrency: 20 });
    expect(resolveWorkerTuning({ SEND_WORKER_CLAIM_LIMIT: "100000", SEND_WORKER_CONCURRENCY: "999" })).toEqual({ limit: 500, concurrency: 50 });
  });

  it("ignores invalid values instead of failing the run", () => {
    expect(resolveWorkerTuning({ SEND_WORKER_CLAIM_LIMIT: "zero", SEND_WORKER_CONCURRENCY: "-3" })).toEqual({ limit: 100, concurrency: 10 });
  });
});

describe("createSendRunCache", () => {
  it("loads each key once per run, including concurrent callers", async () => {
    const cache = createSendRunCache();
    const load = vi.fn(async () => ({ id: "campaign-1" }));
    const [a, b] = await Promise.all([cache.memo("campaign:1", load), cache.memo("campaign:1", load)]);
    await cache.memo("campaign:1", load);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed load, so the next lead retries it", async () => {
    const cache = createSendRunCache();
    const load = vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce("ok");
    await expect(cache.memo("settings:u", load)).rejects.toThrow("blip");
    await expect(cache.memo("settings:u", load)).resolves.toBe("ok");
  });
});
