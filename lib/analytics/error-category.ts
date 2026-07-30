// Pure, presentation-layer classification of an already-stored
// send_attempts.last_error string into a display category. This does not
// change how the provider or worker classify/handle errors (that logic
// stays in lib/email/providers/smtp.ts, untouched) — it only groups
// existing error text for the analytics "failure analysis" view.

export type ErrorCategory = "dns" | "authentication" | "tls" | "timeout" | "unknown";

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  dns: "DNS",
  authentication: "Authentication",
  tls: "TLS",
  timeout: "Timeout",
  unknown: "Unknown",
};

const PATTERNS: { category: ErrorCategory; test: RegExp }[] = [
  { category: "dns", test: /enotfound|eai_again|getaddrinfo/i },
  { category: "authentication", test: /invalid login|auth(entication)? failed|\beauth\b|\b535\b/i },
  { category: "tls", test: /\btls\b|\bssl\b|certificate|wrong version number|esocket/i },
  { category: "timeout", test: /etimedout|timed? ?out/i },
];

export function classifyErrorCategory(message: string | null): ErrorCategory {
  if (!message) return "unknown";
  for (const { category, test } of PATTERNS) {
    if (test.test(message)) return category;
  }
  return "unknown";
}
