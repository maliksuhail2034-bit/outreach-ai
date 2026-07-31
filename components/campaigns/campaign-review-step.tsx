"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import type { Tables } from "@/types/database.types";
import type { MailboxSafe } from "@/lib/db";
import type { SendingWindow } from "@/lib/validations/sending-window";
import { launchCampaignAction } from "@/app/(app)/campaigns/[campaignId]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Campaign = Tables<"campaigns">;
type CampaignLead = Tables<"campaign_leads">;
type SequenceStep = Tables<"sequence_steps">;

const DAY_LABEL: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function delayLabel(dayDelay: number) {
  if (dayDelay === 0) return "Same day";
  return `+${dayDelay} day${dayDelay === 1 ? "" : "s"}`;
}

export function CampaignReviewStep({
  campaign,
  campaignLeads,
  mailboxes,
  sequenceSteps,
  sendingWindow,
}: {
  campaign: Campaign;
  campaignLeads: CampaignLead[];
  mailboxes: MailboxSafe[];
  sequenceSteps: SequenceStep[];
  sendingWindow: SendingWindow;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const defaultMailbox = campaign.default_mailbox_id
    ? mailboxes.find((mailbox) => mailbox.id === campaign.default_mailbox_id)
    : undefined;
  const sortedSteps = [...sequenceSteps].sort((a, b) => a.step_order - b.step_order);
  const windowDays = sendingWindow.days.map((day) => DAY_LABEL[day]).join(", ");

  function handleLaunch() {
    startTransition(async () => {
      try {
        await launchCampaignAction(campaign.id);
        toast.success("Campaign launched.");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't launch the campaign.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review &amp; launch</CardTitle>
        <CardDescription>Double-check everything before this campaign starts sending.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Leads enrolled</dt>
            <dd className="text-lg font-medium">{campaignLeads.length}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Sending mailbox</dt>
            <dd className="text-lg font-medium">
              {defaultMailbox ? defaultMailbox.display_name || defaultMailbox.email : "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Sending window</dt>
            <dd className="text-lg font-medium">
              {windowDays}, {sendingWindow.startHour}:00–{sendingWindow.endHour}:00 ({sendingWindow.timezone})
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Daily limit</dt>
            <dd className="text-lg font-medium">{campaign.daily_limit}/day</dd>
          </div>
        </dl>

        <div>
          <p className="mb-2 text-sm text-muted-foreground">Sequence ({sortedSteps.length} step{sortedSteps.length === 1 ? "" : "s"})</p>
          <ul className="space-y-1">
            {sortedSteps.map((step, index) => (
              <li key={step.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{delayLabel(step.day_delay)}</Badge>
                <span className="truncate">{step.subject || `Step ${index + 1} (no subject)`}</span>
              </li>
            ))}
          </ul>
        </div>

        <Button onClick={handleLaunch} disabled={isPending}>
          {isPending ? "Launching…" : "Launch campaign"}
        </Button>
      </CardContent>
    </Card>
  );
}
