import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAccessTokenCache, getCachedAccessToken, invalidateCachedAccessToken } from "./access-token-cache";

beforeEach(() => clearAccessTokenCache());

describe("getCachedAccessToken", () => {
  it("reuses a token until shortly before it expires, then refreshes", async () => {
    let now = 0;
    const refresh = vi.fn(async () => ({ accessToken: `token-${refresh.mock.calls.length}`, expiresInSeconds: 3600 }));

    expect(await getCachedAccessToken("google", "rt", refresh, () => now)).toBe("token-1");
    now = 50 * 60_000; // 50 min — inside the 55 min usable lifetime
    expect(await getCachedAccessToken("google", "rt", refresh, () => now)).toBe("token-1");
    now = 56 * 60_000; // past expiry minus the 5 min safety margin
    expect(await getCachedAccessToken("google", "rt", refresh, () => now)).toBe("token-2");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keys by provider and refresh token", async () => {
    const refresh = vi.fn(async () => ({ accessToken: `token-${refresh.mock.calls.length}`, expiresInSeconds: 3600 }));
    await getCachedAccessToken("google", "rt-a", refresh);
    await getCachedAccessToken("google", "rt-b", refresh);
    await getCachedAccessToken("microsoft", "rt-a", refresh);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    let resolve!: (value: { accessToken: string; expiresInSeconds: number }) => void;
    const refresh = vi.fn(() => new Promise<{ accessToken: string; expiresInSeconds: number }>((r) => (resolve = r)));

    const first = getCachedAccessToken("google", "rt", refresh);
    const second = getCachedAccessToken("google", "rt", refresh);
    resolve({ accessToken: "shared", expiresInSeconds: 3600 });

    await expect(Promise.all([first, second])).resolves.toEqual(["shared", "shared"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("token endpoint down"))
      .mockResolvedValueOnce({ accessToken: "recovered", expiresInSeconds: 3600 });

    await expect(getCachedAccessToken("google", "rt", refresh)).rejects.toThrow("token endpoint down");
    await expect(getCachedAccessToken("google", "rt", refresh)).resolves.toBe("recovered");
  });

  it("does not cache a token too short-lived to outlast the safety margin", async () => {
    const refresh = vi.fn(async () => ({ accessToken: "short", expiresInSeconds: 60 }));
    await getCachedAccessToken("google", "rt", refresh);
    await getCachedAccessToken("google", "rt", refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes after an explicit invalidation", async () => {
    const refresh = vi.fn(async () => ({ accessToken: `token-${refresh.mock.calls.length}`, expiresInSeconds: 3600 }));
    await getCachedAccessToken("microsoft", "rt", refresh);
    invalidateCachedAccessToken("microsoft", "rt");
    expect(await getCachedAccessToken("microsoft", "rt", refresh)).toBe("token-2");
  });
});
