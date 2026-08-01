// Contract a future job queue/worker backend will implement to actually
// run warmup cycles at scale — a cron-triggered route handler (matching
// this codebase's existing app/api/cron/* pattern), a hosted queue
// (Inngest, QStash), or a distributed worker pool. No implementation
// exists yet: see queues/no-op.ts and Task 6's explicit scope (no real
// sending, no real scheduling execution this phase). Mirrors
// lib/deliverability/dns-provider.ts's split.
export interface WarmupJob {
  warmupProfileId: string;
  scheduledFor: string; // ISO
}

export interface WarmupQueue {
  enqueue(job: WarmupJob): Promise<void>;
}
