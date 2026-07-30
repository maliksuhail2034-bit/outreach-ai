import type { Tables } from "@/types/database.types";
import type { EmailProvider } from "./provider";
import { SmtpEmailProvider } from "./providers/smtp";

// One-line factory so callers (the future sending worker) never import
// SmtpEmailProvider directly and depend only on the EmailProvider interface.
// This is the entire seam a second provider needs: add its class under
// providers/, branch on it here. No registry, no config-driven dispatch —
// there's nothing to select between until a second implementation exists.
export function getEmailProvider(mailbox: Tables<"mailboxes">): EmailProvider {
  return new SmtpEmailProvider(mailbox);
}
