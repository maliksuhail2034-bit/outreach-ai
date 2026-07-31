"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldAlertIcon, UserPlusIcon } from "lucide-react";

import type { MailboxSafe } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { enrollLeadAction, enrollLeadListAction } from "@/app/(app)/campaigns/[campaignId]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function reasonLabel(reason: string) {
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

type Lead = Tables<"leads">;
type LeadList = Tables<"lead_lists">;

const USE_DEFAULT = "default";

function leadDisplay(lead: Lead) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  return name || lead.email;
}

export function EnrollDialog({
  campaignId,
  availableLeads,
  leadLists,
  mailboxes,
  suppressionReasonByEmail,
}: {
  campaignId: string;
  availableLeads: Lead[];
  leadLists: LeadList[];
  mailboxes: MailboxSafe[];
  suppressionReasonByEmail: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"lead" | "list">("lead");
  const [leadId, setLeadId] = useState("");
  const [listId, setListId] = useState("");
  const [mailboxId, setMailboxId] = useState(USE_DEFAULT);
  const [confirmSuppressed, setConfirmSuppressed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setLeadId("");
    setListId("");
    setMailboxId(USE_DEFAULT);
    setConfirmSuppressed(false);
  }

  // Only leads not yet enrolled in this campaign are ever candidates here
  // (availableLeads already excludes enrolled ones), so this count matches
  // exactly what addLeadsToCampaign would actually insert.
  const selectedLead = mode === "lead" ? availableLeads.find((lead) => lead.id === leadId) : undefined;
  const selectedLeadSuppressionReason = selectedLead ? suppressionReasonByEmail.get(selectedLead.email) : undefined;
  const suppressedInSelectedList =
    mode === "list" && listId
      ? availableLeads.filter((lead) => lead.list_id === listId && suppressionReasonByEmail.has(lead.email)).length
      : 0;
  const hasSuppressionWarning =
    mode === "lead" ? Boolean(selectedLeadSuppressionReason) : suppressedInSelectedList > 0;

  function handleSubmit() {
    const override = mailboxId === USE_DEFAULT ? undefined : mailboxId;

    startTransition(async () => {
      try {
        if (mode === "lead") {
          if (!leadId) {
            toast.error("Choose a lead to enroll.");
            return;
          }
          await enrollLeadAction(campaignId, leadId, override, confirmSuppressed);
          toast.success("Lead enrolled.");
        } else {
          if (!listId) {
            toast.error("Choose a list to enroll.");
            return;
          }
          const result = await enrollLeadListAction(campaignId, listId, override, confirmSuppressed);
          toast.success(
            result.skipped > 0
              ? `${result.inserted} lead${result.inserted === 1 ? "" : "s"} enrolled, ${result.skipped} already enrolled.`
              : `${result.inserted} lead${result.inserted === 1 ? "" : "s"} enrolled.`,
          );
        }
        reset();
        setOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't enroll. Try again.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlusIcon />
          Enroll leads
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enroll leads</DialogTitle>
          <DialogDescription>Add a single lead or an entire list to this campaign.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "lead" ? "default" : "outline"}
            onClick={() => {
              setMode("lead");
              setConfirmSuppressed(false);
            }}
          >
            Single lead
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "list" ? "default" : "outline"}
            onClick={() => {
              setMode("list");
              setConfirmSuppressed(false);
            }}
          >
            Entire list
          </Button>
        </div>

        {mode === "lead" ? (
          <Select
            value={leadId}
            onValueChange={(value) => {
              setLeadId(value);
              setConfirmSuppressed(false);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a lead" />
            </SelectTrigger>
            <SelectContent>
              {availableLeads.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">All leads are already enrolled.</div>
              ) : (
                availableLeads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {leadDisplay(lead)}
                    {suppressionReasonByEmail.has(lead.email) ? " (suppressed)" : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={listId}
            onValueChange={(value) => {
              setListId(value);
              setConfirmSuppressed(false);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a list" />
            </SelectTrigger>
            <SelectContent>
              {leadLists.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">No lead lists yet.</div>
              ) : (
                leadLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}

        {hasSuppressionWarning && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-2">
              <p>
                {mode === "lead"
                  ? `This lead is suppressed (${reasonLabel(selectedLeadSuppressionReason ?? "")}). They won't receive emails unless this is intended.`
                  : `${suppressedInSelectedList} lead${suppressedInSelectedList === 1 ? "" : "s"} in this list ${suppressedInSelectedList === 1 ? "is" : "are"} suppressed (bounced/unsubscribed). They won't receive emails unless this is intended.`}
              </p>
              <label className="flex items-center gap-2 text-foreground">
                <input
                  type="checkbox"
                  className="size-4 rounded-sm border-input accent-primary"
                  checked={confirmSuppressed}
                  onChange={(e) => setConfirmSuppressed(e.target.checked)}
                />
                Enroll anyway
              </label>
            </div>
          </div>
        )}

        <Select value={mailboxId} onValueChange={setMailboxId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Use campaign default mailbox" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={USE_DEFAULT}>Use campaign default mailbox</SelectItem>
            {mailboxes.map((mailbox) => (
              <SelectItem key={mailbox.id} value={mailbox.id}>
                {mailbox.display_name || mailbox.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DialogFooter>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || (hasSuppressionWarning && !confirmSuppressed)}
          >
            {isPending ? "Enrolling…" : "Enroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
