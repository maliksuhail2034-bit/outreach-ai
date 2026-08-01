import type { UpcomingSend } from "@/lib/campaigns/queue";
import type { MailboxSafe } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Lead = Tables<"leads">;
type SequenceStep = Tables<"sequence_steps">;

function leadDisplay(lead: Lead | undefined) {
  if (!lead) return "Unknown lead";
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  return name || lead.email;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Read-only scheduling visibility (Phase 2E) — renders lib/campaigns/queue.ts's
// selectUpcomingSends() output. No mutations here: adjusting a lead's
// mailbox/status/schedule stays CampaignLeadTable's job.
export function CampaignQueueView({
  sends,
  leads,
  mailboxes,
  steps,
}: {
  sends: UpcomingSend[];
  leads: Lead[];
  mailboxes: MailboxSafe[];
  steps: SequenceStep[];
}) {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  // steps is already ordered by step_order (see listSequenceSteps), so
  // position in this array is the 1-based step number — same resolution
  // CampaignLeadTable already uses for its "Step N" labels.
  const stepPositionById = new Map(steps.map((step, index) => [step.id, index + 1]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming sends</CardTitle>
        <CardDescription>
          {sends.length === 0
            ? "The next scheduled sends for this campaign, soonest first."
            : `The next ${sends.length} scheduled send${sends.length === 1 ? "" : "s"}, soonest first.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sends.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">Nothing scheduled right now</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upcoming sends appear here once leads are active and due.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Lead</th>
                  <th className="py-2 pr-4 font-medium">Mailbox</th>
                  <th className="py-2 pr-4 font-medium">Step</th>
                  <th className="py-2 pr-4 font-medium">Scheduled</th>
                  <th className="py-2 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sends.map((send) => {
                  const lead = leadById.get(send.leadId);
                  const mailbox = send.mailboxId ? mailboxById.get(send.mailboxId) : undefined;
                  const stepPosition = send.sequenceStepId ? stepPositionById.get(send.sequenceStepId) : undefined;

                  return (
                    <tr key={send.campaignLeadId}>
                      <td className="max-w-48 truncate py-3 pr-4">
                        <p className="truncate font-medium">{leadDisplay(lead)}</p>
                        {lead && <p className="truncate text-xs text-muted-foreground">{lead.email}</p>}
                      </td>
                      <td className="max-w-40 truncate py-3 pr-4 text-muted-foreground">
                        {mailbox ? mailbox.display_name || mailbox.email : "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {stepPosition ? `Step ${stepPosition}` : "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {dateTimeFormatter.format(new Date(send.scheduledAt))}
                      </td>
                      <td className="py-3 pl-4">
                        <Badge variant={send.status === "sending" ? "secondary" : "outline"}>
                          {send.status === "sending" ? "Sending…" : "Scheduled"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
