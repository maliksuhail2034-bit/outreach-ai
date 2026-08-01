import { describe, expect, it } from "vitest";
import { NoOpWarmupQueue } from "./no-op";

describe("NoOpWarmupQueue", () => {
  it("records enqueued jobs without doing anything with them", async () => {
    const queue = new NoOpWarmupQueue();
    await queue.enqueue({ warmupProfileId: "profile-1", scheduledFor: "2026-08-03T00:00:00.000Z" });

    expect(queue.peekJobs()).toEqual([{ warmupProfileId: "profile-1", scheduledFor: "2026-08-03T00:00:00.000Z" }]);
  });
});
