import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkAndRecordMock } = vi.hoisted(() => ({
  checkAndRecordMock: vi.fn(),
}));

vi.mock("./get-provider", () => ({
  getRateLimiter: () => ({ checkAndRecord: checkAndRecordMock }),
}));

import { checkRateLimit, RateLimitError } from "./check-rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkRateLimit", () => {
  it("resolves without throwing when the limiter allows the attempt", async () => {
    checkAndRecordMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });

    await expect(checkRateLimit("ai:generate", "org-1")).resolves.toBeUndefined();
  });

  it("throws RateLimitError with the retryAfterSeconds from the limiter when blocked", async () => {
    checkAndRecordMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });

    const error = await checkRateLimit("ai:generate", "org-1").catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfterSeconds).toBe(90);
  });

  it("never leaks the scope name or count into the thrown error's message", async () => {
    checkAndRecordMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });

    const error: RateLimitError = await checkRateLimit("ai:generate", "org-1").catch((e) => e);
    expect(error.message).not.toContain("ai:generate");
    expect(error.message).not.toContain("org-1");
    expect(error.message).toMatch(/Too many attempts/);
  });

  it("fails closed (throws) on an infrastructure error for a failClosed scope (auth:sign_in)", async () => {
    checkAndRecordMock.mockRejectedValue(new Error("db unavailable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(checkRateLimit("auth:sign_in", "1.2.3.4")).rejects.toBeInstanceOf(RateLimitError);

    consoleErrorSpy.mockRestore();
  });

  it("fails open (does not throw) on an infrastructure error for a non-failClosed scope (ai:generate)", async () => {
    checkAndRecordMock.mockRejectedValue(new Error("db unavailable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(checkRateLimit("ai:generate", "org-1")).resolves.toBeUndefined();

    consoleErrorSpy.mockRestore();
  });
});
