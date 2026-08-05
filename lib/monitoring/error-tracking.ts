import type { CronJobName } from "./heartbeat";

export interface CaptureErrorInput {
  job: CronJobName;
  message: string;
  context?: Record<string, unknown>;
}

// Bounds how long a forward can hang — a slow/unreachable destination must
// never delay (or throw out of) a catch block that's already handling a
// real failure.
const REQUEST_TIMEOUT_MS = 10_000;

// Optional, env-gated forward of an already-classified failure to an
// external destination (Slack/Discord/any endpoint that accepts JSON) — the
// same "no-op until configured" shape as every other optional integration
// in this codebase (see lib/integrations/providers/webhook.ts). Every call
// site already console.error's the same failure; this is an additive
// forward, not a replacement, so losing the webhook can never lose the
// local log.
export async function captureError(input: CaptureErrorInput): Promise<void> {
  const url = process.env.ERROR_TRACKING_WEBHOOK_URL;
  if (!url) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, occurredAt: new Date().toISOString() }),
      signal: controller.signal,
    });
  } catch (error) {
    // Best-effort only — never let the destination being unreachable throw
    // out of an already-failing code path.
    console.error("[error-tracking]", "failed to forward error", error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(timeout);
  }
}
