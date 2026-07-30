import type { Tables } from "@/types/database.types";
import type { ReplyProvider } from "./reply-provider";
import { ImapReplyChecker } from "./reply-providers/imap";

// One-line factory — the entire seam a second reply provider (Gmail API,
// Microsoft Graph) needs later, mirroring lib/email/get-provider.ts exactly.
// Branches on mailboxes.reply_provider once a second value exists; today
// only 'imap' is valid (enforced by the column's check constraint).
export function getReplyProvider(mailbox: Tables<"mailboxes">): ReplyProvider {
  return new ImapReplyChecker(mailbox);
}
