"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import type { Tables } from "@/types/database.types";
import type { MailboxSafe } from "@/lib/db";
import type { SendingWindow } from "@/lib/validations/sending-window";
import { updateCampaignAction } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Campaign = Tables<"campaigns">;

// updateCampaignAction takes the full campaign shape (campaignSchema has no
// partial-update variant — see lib/validations/campaigns.ts), so this only
// changes defaultMailboxId while resubmitting every other field unchanged,
// the same way CampaignForm's edit mode already does. sendingWindow is
// passed in already-resolved (computed server-side in page.tsx) rather than
// calling resolveSendingWindow here, so lib/email/scheduling.ts (and luxon)
// never needs to enter the client bundle.
export function MailboxAssignmentStep({
  campaign,
  mailboxes,
  sendingWindow,
  onAssigned,
}: {
  campaign: Campaign;
  mailboxes: MailboxSafe[];
  sendingWindow: SendingWindow;
  onAssigned: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(mailboxId: string) {
    startTransition(async () => {
      try {
        await updateCampaignAction(campaign.id, {
          name: campaign.name,
          dailyLimit: campaign.daily_limit,
          defaultMailboxId: mailboxId,
          sendingWindow,
          status: campaign.status as "draft" | "active" | "paused" | "completed",
        });
        toast.success("Mailbox assigned.");
        onAssigned();
      } catch {
        toast.error("Couldn't assign the mailbox. Try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign a sending mailbox</CardTitle>
        <CardDescription>
          Every enrolled lead sends from this mailbox unless overridden individually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mailboxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No mailboxes connected yet. <Button variant="link" className="h-auto p-0" asChild>
              <a href="/mailboxes">Connect one first</a>
            </Button>
            .
          </p>
        ) : (
          <Select
            value={campaign.default_mailbox_id ?? undefined}
            onValueChange={handleChange}
            disabled={isPending}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue placeholder="Choose a mailbox" />
            </SelectTrigger>
            <SelectContent>
              {mailboxes.map((mailbox) => (
                <SelectItem key={mailbox.id} value={mailbox.id}>
                  {mailbox.display_name || mailbox.email}
                  {mailbox.status !== "active" ? ` (${mailbox.status})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  );
}
