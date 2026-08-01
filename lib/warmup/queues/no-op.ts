import type { WarmupJob, WarmupQueue } from "../queue";

// Accepts and discards — no queue backend exists yet. The only
// WarmupQueue implementation today; a real backend (see ../queue.ts)
// implements this same interface and is returned from get-queue.ts
// instead — nothing else in the app changes.
export class NoOpWarmupQueue implements WarmupQueue {
  private readonly jobs: WarmupJob[] = [];

  async enqueue(job: WarmupJob): Promise<void> {
    this.jobs.push(job);
  }

  // Test/debug seam only, so a caller can confirm what would have been
  // enqueued — nothing actually runs.
  peekJobs(): readonly WarmupJob[] {
    return this.jobs;
  }
}
