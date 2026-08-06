"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";

import type { MailboxSafe } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { deleteCampaignAction } from "@/app/(app)/campaigns/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { CampaignForm } from "./campaign-form";

type Campaign = Tables<"campaigns">;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  active: "default",
  paused: "secondary",
  completed: "secondary",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function CampaignList({
  campaigns,
  mailboxes,
  page,
  pageSize,
  totalCount,
}: {
  campaigns: Campaign[];
  mailboxes: MailboxSafe[];
  page: number;
  pageSize: number;
  totalCount: number;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  // New campaigns land straight in the setup wizard (app/(app)/campaigns/
  // [campaignId]/page.tsx shows it automatically while status is 'draft')
  // instead of just closing the dialog and leaving the user on the list.
  function handleCreated(id?: string) {
    setAddOpen(false);
    if (id) router.push(`/campaigns/${id}`);
  }

  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startDeleteTransition(async () => {
      try {
        await deleteCampaignAction(target.id);
        toast.success("Campaign removed.");
        setDeleting(null);
      } catch {
        toast.error("Couldn't remove the campaign. Try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Campaigns</CardTitle>
          <CardDescription>Group leads and a sending mailbox into an outbound campaign.</CardDescription>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <PlusIcon />
              Add campaign
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New campaign</DialogTitle>
              <DialogDescription>Name your campaign and set a default sending mailbox.</DialogDescription>
            </DialogHeader>
            <CampaignForm mode="create" mailboxes={mailboxes} onSuccess={handleCreated} />
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">No campaigns yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a campaign to start enrolling leads.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {campaigns.map((campaign) => {
              const defaultMailbox = campaign.default_mailbox_id
                ? mailboxById.get(campaign.default_mailbox_id)
                : undefined;

              return (
                <li key={campaign.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <Link
                    href={`/campaigns/${campaign.id}`}
                    className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{campaign.name}</p>
                      <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>
                        {statusLabel(campaign.status)}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {campaign.daily_limit}/day
                      {defaultMailbox
                        ? ` · ${defaultMailbox.display_name || defaultMailbox.email}`
                        : " · No default mailbox"}
                    </p>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${campaign.name}`}
                    onClick={() => setDeleting(campaign)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {campaigns.length > 0 && (
        <CardContent className="border-t border-border pt-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            onPageChange={(nextPage) => router.push(`/campaigns?page=${nextPage}`)}
          />
        </CardContent>
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove campaign?</DialogTitle>
            <DialogDescription>
              This removes &ldquo;{deleting?.name}&rdquo; and its lead enrollments permanently. Leads themselves
              aren&apos;t deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Removing…" : "Remove campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
