import type { Tables } from "@/types/database.types";
import { ScoreBadge } from "@/components/deliverability/score-badge";

// Presentational only — the score itself comes from mailbox_health
// (written by calculateMailboxHealthScore in
// settings/deliverability/actions.ts, the same "recalculate" action the
// Deliverability page's own mailbox list uses). Extracted from the Mailbox
// Analytics page so Mailbox Comparison renders the identical block instead
// of a second copy of the same JSX.
export function MailboxHealthSummary({ mailboxHealth }: { mailboxHealth: Tables<"mailbox_health"> | null }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Mailbox health</span>
        <ScoreBadge score={mailboxHealth?.health_score ?? 0} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Reputation: {mailboxHealth?.reputation_score ?? "Not measured"}
        {" · Bounce: "}
        {mailboxHealth?.bounce_rate == null ? "Not measured" : `${mailboxHealth.bounce_rate}%`}
        {" · Reply: "}
        {mailboxHealth?.reply_rate == null ? "Not measured" : `${mailboxHealth.reply_rate}%`}
      </p>
    </div>
  );
}
