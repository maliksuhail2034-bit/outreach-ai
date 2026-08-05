import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordRateLimitAttemptMock } = vi.hoisted(() => ({
  recordRateLimitAttemptMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/lib/db", () => ({
  recordRateLimitAttempt: recordRateLimitAttemptMock,
}));

import { PostgresRateLimiter } from "./postgres";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PostgresRateLimiter", () => {
  it("delegates to recordRateLimitAttempt with the service-role client and maps the result", async () => {
    recordRateLimitAttemptMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    const limiter = new PostgresRateLimiter();

    const result = await limiter.checkAndRecord("ai:generate", "org-1", { windowSeconds: 3600, maxAttempts: 20 });

    expect(recordRateLimitAttemptMock).toHaveBeenCalledWith(expect.anything(), "ai:generate", "org-1", 3600, 20);
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("propagates a blocked result", async () => {
    recordRateLimitAttemptMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const limiter = new PostgresRateLimiter();

    const result = await limiter.checkAndRecord("ai:generate", "org-1", { windowSeconds: 3600, maxAttempts: 20 });

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 120 });
  });
});
