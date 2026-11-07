// Decides whether an open or click came from a person or from a machine
// (a corporate security scanner, link checker or image prefetcher). Pure,
// so every rule is unit-tested; the tracking routes call it and store the
// result as email_events.is_bot, which every engagement count and every
// step condition excludes.
//
// Deliberately conservative: an event is marked as a bot only on clear
// evidence. Apple Mail Privacy Protection prefetches look like an ordinary
// browser and can't be told apart reliably, so they still count as opens;
// clicks (which MPP never makes) are the stronger signal.

export type EngagementKind = "opened" | "clicked";

export interface EngagementClassification {
  isBot: boolean;
  reason: string | null;
}

// Security gateways and link checkers that fetch every link or image in
// incoming mail. Gmail's image proxy (GoogleImageProxy) is NOT here: Gmail
// fetches images when the person opens the email.
const SCANNER_PATTERN =
  /bot\b|crawler|spider|scanner|safelinks|outlook-safe|proofpoint|mimecast|barracuda|symantec|forcepoint|trend ?micro|sophos|fortiguard|checkpoint|zscaler|cisco|ironport|messagelabs|appriver|libwww|curl\/|wget\/|python-requests|go-http-client|java\/|okhttp|headless|phantomjs|slackbot|facebookexternalhit|linkedinbot|whatsapp|telegrambot|preview/i;

// Outlook desktop fetches images with an Office user agent when a person
// opens the email, so this is a person for opens. For clicks it's Office's
// link-check preflight, made before the browser opens the link.
const OFFICE_LINK_CHECK_PATTERN = /microsoft office|ms-office|msoffice/i;

// Faster than a person could receive, open and react to an email.
const MIN_HUMAN_SECONDS: Record<EngagementKind, number> = { opened: 5, clicked: 20 };

export function classifyEngagement(input: {
  kind: EngagementKind;
  userAgent: string | null;
  sentAt: Date | null;
  now?: Date;
}): EngagementClassification {
  const userAgent = input.userAgent?.trim() ?? "";
  if (!userAgent) return { isBot: true, reason: "no user agent" };
  if (SCANNER_PATTERN.test(userAgent)) return { isBot: true, reason: "scanner user agent" };
  if (input.kind === "clicked" && OFFICE_LINK_CHECK_PATTERN.test(userAgent)) {
    return { isBot: true, reason: "office link check" };
  }

  if (input.sentAt) {
    const seconds = ((input.now ?? new Date()).getTime() - input.sentAt.getTime()) / 1000;
    if (seconds >= 0 && seconds < MIN_HUMAN_SECONDS[input.kind]) {
      return { isBot: true, reason: `within ${MIN_HUMAN_SECONDS[input.kind]}s of sending` };
    }
  }

  return { isBot: false, reason: null };
}
