import { normalizeMessageId } from "./message-id";
import { RECIPIENT_BOUNCE_ENHANCED_CODES } from "./providers/smtp";

// Asynchronous bounces. Gmail and Outlook submission servers accept every
// external recipient at RCPT TO, so a dead address isn't rejected while
// sending (classifySmtpError never sees it) — it comes back later as a
// delivery status notification (RFC 3464) in the sending mailbox's inbox,
// where reply sync picks it up.
//
// Recognised only by structure, never by wording: a multipart/report with
// report-type=delivery-status. Within it, a recipient counts as hard-bounced
// only when its per-recipient block says Action: failed with an address-level
// status code — the same RECIPIENT_BOUNCE_ENHANCED_CODES the synchronous path
// uses. Delayed (4.x.x) notices and permanent failures that aren't about the
// address (policy, content, quota, mailbox full) are still delivery reports,
// so never treated as a reply, but suppress nobody.
export interface DeliveryReport {
  // Lowercased addresses that hard-bounced.
  hardBouncedRecipients: string[];
  // Message-ID of the message that failed, read from the original message
  // (or its headers) the report returns. Null if the report didn't include it.
  originalMessageId: string | null;
}

export interface DeliveryReportSource {
  // The parsed top-level Content-Type header (mailparser's structured value).
  contentType: unknown;
  parts: { contentType: string; content: Buffer | string }[];
}

const ORIGINAL_MESSAGE_PART_TYPES = new Set(["message/rfc822", "text/rfc822-headers"]);
const STATUS_CODE_PATTERN = /^([245]\.\d{1,3}\.\d{1,3})(?!\.?\d)/;

export function parseDeliveryReport(source: DeliveryReportSource): DeliveryReport | null {
  if (!isDeliveryStatusReport(source.contentType)) return null;

  const statusPart = source.parts.find((part) => part.contentType.toLowerCase() === "message/delivery-status");
  const originalPart = source.parts.find((part) => ORIGINAL_MESSAGE_PART_TYPES.has(part.contentType.toLowerCase()));

  return {
    hardBouncedRecipients: statusPart ? findHardBouncedRecipients(asText(statusPart.content)) : [],
    originalMessageId: originalPart ? normalizeMessageId(readHeader(asText(originalPart.content), "message-id")) : null,
  };
}

// Bounce notices that don't follow RFC 3464 still come from the receiving
// system's own address. Nobody replies to a prospecting email from one.
const MAIL_SYSTEM_LOCAL_PARTS = new Set(["mailer-daemon", "postmaster"]);

export function isMailSystemSender(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  return MAIL_SYSTEM_LOCAL_PARTS.has(email.slice(0, at).toLowerCase());
}

function isDeliveryStatusReport(contentType: unknown): boolean {
  if (typeof contentType !== "object" || contentType === null || !("value" in contentType)) return false;
  const { value } = contentType;
  const params = "params" in contentType ? contentType.params : undefined;
  const reportType =
    typeof params === "object" && params !== null && "report-type" in params ? params["report-type"] : undefined;
  return (
    typeof value === "string" &&
    value.toLowerCase() === "multipart/report" &&
    typeof reportType === "string" &&
    reportType.toLowerCase() === "delivery-status"
  );
}

function findHardBouncedRecipients(deliveryStatus: string): string[] {
  const recipients = new Set<string>();
  for (const fields of parseFieldGroups(deliveryStatus)) {
    const recipient = parseFinalRecipient(fields.get("final-recipient"));
    if (!recipient) continue;
    if (fields.get("action")?.toLowerCase() !== "failed") continue;
    const statusCode = fields.get("status")?.match(STATUS_CODE_PATTERN)?.[1];
    if (statusCode && RECIPIENT_BOUNCE_ENHANCED_CODES.has(statusCode)) recipients.add(recipient);
  }
  return [...recipients];
}

// "rfc822; someone@example.com" — only the rfc822 address type names an
// email address (RFC 3464 §2.3.2).
function parseFinalRecipient(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.indexOf(";");
  if (separator === -1 || value.slice(0, separator).trim().toLowerCase() !== "rfc822") return null;
  const address = value
    .slice(separator + 1)
    .trim()
    .replace(/^<|>$/g, "")
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(address) ? address : null;
}

// A delivery-status body is header-style field groups separated by blank
// lines: the per-message group first, then one group per recipient.
function parseFieldGroups(body: string): Map<string, string>[] {
  return unfold(body)
    .split(/\n\s*\n/)
    .map((group) => {
      const fields = new Map<string, string>();
      for (const line of group.split("\n")) {
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        const name = line.slice(0, colon).trim().toLowerCase();
        if (!fields.has(name)) fields.set(name, line.slice(colon + 1).trim());
      }
      return fields;
    });
}

function readHeader(message: string, name: string): string | null {
  const headerSection = unfold(message).split(/\n\s*\n/)[0] ?? "";
  const fields = parseFieldGroups(headerSection)[0];
  return fields?.get(name) ?? null;
}

// Normalizes line endings and joins folded continuation lines (RFC 5322 §2.2.3).
function unfold(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]+/g, " ");
}

function asText(content: Buffer | string): string {
  return typeof content === "string" ? content : content.toString("utf8");
}
