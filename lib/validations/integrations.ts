import { z } from "zod";

// Hostnames/IP ranges that must never be accepted as a webhook target — the
// worker and the "send test digest" action both call out to this URL from
// the server, so an internal/loopback target would let a user (or anyone
// who compromises their session) probe this app's own network. This is a
// pragmatic first line of defense (a literal hostname/IP check), not
// exhaustive SSRF protection — it doesn't catch a public hostname that
// later resolves to a private address (DNS rebinding). A future iteration
// can add a resolve-then-check step if a real provider needs it.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
];

function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname));
}

export const webhookIntegrationSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, { message: "Enter a webhook URL." })
    .max(2048)
    .url({ message: "Enter a valid URL." })
    .refine((value) => new URL(value).protocol === "https:", { message: "The webhook URL must use https." })
    .refine((value) => !isBlockedHostname(new URL(value).hostname), {
      message: "This URL points to a local or private address, which isn't allowed.",
    }),
});
export type WebhookIntegrationInput = z.infer<typeof webhookIntegrationSchema>;
