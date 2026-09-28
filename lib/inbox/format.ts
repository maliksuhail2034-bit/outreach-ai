import type { InboxReply } from "@/lib/db/email-replies";

// Display helpers for the inbox (app/(app)/inbox). Everything here works on
// plain text only: inbound mail is attacker-controlled, so the inbox never
// renders body_html.

export function replySubject(reply: Pick<InboxReply, "subject">): string {
  return reply.subject?.trim() || "(no subject)";
}

export function replySenderName(reply: Pick<InboxReply, "from_name" | "from_email">): string {
  return reply.from_name?.trim() || reply.from_email;
}

// The lead's name, falling back to its email — and to the sender's address
// when the lead row isn't available.
export function replyLeadName(reply: Pick<InboxReply, "lead" | "from_email">): string {
  if (!reply.lead) return reply.from_email;
  const full = [reply.lead.first_name, reply.lead.last_name].filter(Boolean).join(" ").trim();
  return full || reply.lead.email;
}

const SNIPPET_LENGTH = 140;

// A one-line preview of the new text: quoted lines ("> ...") dropped,
// whitespace collapsed, truncated.
export function replySnippet(bodyText: string | null, maxLength: number = SNIPPET_LENGTH): string {
  if (!bodyText) return "";
  const text = bodyText
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelativeTime(value: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(value).getTime() - now.getTime()) / 1000);
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= unitSeconds) return relativeFormatter.format(Math.trunc(seconds / unitSeconds), unit);
  }
  return "just now";
}

export function parseInboxPage(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
