import { describe, expect, it, vi } from "vitest";
import { awaitSubscriptionConfirmation } from "./await-subscription-confirmation";

const noSleep = vi.fn(async () => {});

describe("awaitSubscriptionConfirmation", () => {
  it("resolves true as soon as the server reports the webhook-confirmed subscription", async () => {
    const checkStatus = vi
      .fn()
      .mockResolvedValueOnce({ confirmed: false })
      .mockResolvedValueOnce({ confirmed: false })
      .mockResolvedValueOnce({ confirmed: true });

    await expect(awaitSubscriptionConfirmation({ checkStatus, sleep: noSleep })).resolves.toBe(true);
    expect(checkStatus).toHaveBeenCalledTimes(3);
  });

  it("gives up after the configured attempts without ever reporting success on its own", async () => {
    const checkStatus = vi.fn(async () => ({ confirmed: false }));

    await expect(awaitSubscriptionConfirmation({ checkStatus, attempts: 4, sleep: noSleep })).resolves.toBe(false);
    expect(checkStatus).toHaveBeenCalledTimes(4);
  });

  it("keeps polling through a transient failure of one check", async () => {
    const checkStatus = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ confirmed: true });

    await expect(awaitSubscriptionConfirmation({ checkStatus, sleep: noSleep })).resolves.toBe(true);
  });

  it("waits between polls but not after the last one", async () => {
    const sleep = vi.fn(async () => {});
    const checkStatus = vi.fn(async () => ({ confirmed: false }));

    await awaitSubscriptionConfirmation({ checkStatus, attempts: 3, intervalMs: 500, sleep });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });
});
