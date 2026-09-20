import Link from "next/link";

import type { MailboxSafe } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { Badge } from "@/components/ui/badge";

type CampaignLead = Tables<"campaign_leads">;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  active: "secondary",
  replied: "secondary",
  completed: "default",
  bounced: "destructive",
  unsubscribed: "destructive",
  needs_review: "destructive",
  failed: "destructive",
};

// Mirrors components/campaigns/campaign-lead-table.tsx's own statusLabel —
// "needs_review"/"failed" only ever come from the send worker, never a form
// select, so this just needs to render every status legibly.
function statusLabel(status: string) {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return dateTimeFormatter.format(new Date(value));
}

export function LeadEnrollmentsTable({
  campaignLeads,
  campaignNameById,
  mailboxes,
}: {
  campaignLeads: CampaignLead[];
  campaignNameById: Map<string, string>;
  mailboxes: MailboxSafe[];
}) {
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="p-6 pb-0">
        <h2 className="font-semibold tracking-tight">Campaign enrollments</h2>
        <p className="text-sm text-muted-foreground">
          {campaignLeads.length} campaign{campaignLeads.length === 1 ? "" : "s"} this lead is enrolled in.
        </p>
      </div>

      <div className="p-6">
        {campaignLeads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">Not enrolled in any campaign</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Enroll this lead from a campaign&apos;s enrolled leads panel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Campaign</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Mailbox</th>
                  <th className="py-2 pl-4 font-medium">Next send</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaignLeads.map((row) => {
                  const mailbox = row.mailbox_id ? mailboxById.get(row.mailbox_id) : undefined;
                  return (
                    <tr key={row.id}>
                      <td className="max-w-48 truncate py-3 pr-4 font-medium">
                        <Link href={`/campaigns/${row.campaign_id}`} className="hover:underline">
                          {campaignNameById.get(row.campaign_id) ?? "Unknown campaign"}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>{statusLabel(row.status)}</Badge>
                      </td>
                      <td className="max-w-40 truncate py-3 pr-4 text-muted-foreground">
                        {mailbox ? mailbox.display_name || mailbox.email : "Campaign default"}
                      </td>
                      <td className="py-3 pl-4 text-muted-foreground">{formatDateTime(row.next_send_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
