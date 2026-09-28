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

// Discord rejects a `content` longer than 2000 characters.
const SUMMARY_MAX_LENGTH = 1900;

// One line a person can read in a chat channel: the job, the message, and
// the context values (ids and counts — call sites never put email content
// or credentials in context).
export function formatErrorSummary(input: CaptureErrorInput): string {
  const context = Object.entries(input.context ?? {})
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  const summary = `[${input.job}] ${input.message}${context ? ` (${context})` : ""}`;
  return summary.length > SUMMARY_MAX_LENGTH ? `${summary.slice(0, SUMMARY_MAX_LENGTH - 1)}…` : summary;
}

// Optional, env-gated forward of an already-classified failure to an
// external destination (Slack/Discord/any endpoint that accepts JSON) — the
// same "no-op until configured" shape as every other optional integration
// in this codebase (see lib/integrations/providers/webhook.ts). Every call
// site already console.error's the same failure; this is an additive
// forward, not a replacement, so losing the webhook can never lose the
// local log.
//
// Slack incoming webhooks reject a body without `text`, and Discord one
// without `content`, so both carry the same readable summary; the structured
// fields stay for generic JSON receivers.
export async function captureError(input: CaptureErrorInput): Promise<void> {
  const url = process.env.ERROR_TRACKING_WEBHOOK_URL;
  if (!url) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const summary = formatErrorSummary(input);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, text: summary, content: summary, occurredAt: new Date().toISOString() }),
      signal: controller.signal,
    });
    // A rejected payload (e.g. a 400 from a misconfigured webhook) resolves
    // normally — logged so it doesn't fail silently.
    if (!response.ok) {
      console.error("[error-tracking]", "webhook rejected the forwarded error", { status: response.status });
    }
  } catch (error) {
    // Best-effort only — never let the destination being unreachable throw
    // out of an already-failing code path.
    console.error("[error-tracking]", "failed to forward error", error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(timeout);
  }
}
