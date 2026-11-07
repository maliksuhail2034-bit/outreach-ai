"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  GitBranchIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import type { Tables } from "@/types/database.types";
import { composerMarkupToPlainText } from "@/lib/email/composer-markup";
import { deleteSequenceStepAction, moveSequenceStepAction } from "@/app/(app)/campaigns/[campaignId]/actions";
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
import { Badge } from "@/components/ui/badge";
import { SequenceStepForm, type EarlierStepOption } from "./sequence-step-form";
import { computeStepDays, conditionWarning, describeCondition } from "./step-timeline";
import { EmailPreviewDialog } from "./email-preview-dialog";
import type { AttachmentSummary } from "./attachment-manager";

type SequenceStep = Tables<"sequence_steps">;

function delayLabel(dayDelay: number, isFirst: boolean) {
  if (isFirst)
    return dayDelay === 0
      ? "When the lead is added"
      : `${dayDelay} day${dayDelay === 1 ? "" : "s"} after the lead is added`;
  if (dayDelay === 0) return "Same day as the previous email";
  return `${dayDelay} day${dayDelay === 1 ? "" : "s"} after the previous email`;
}

function toAttachmentSummaries(rows: Tables<"email_attachments">[] | undefined): AttachmentSummary[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  }));
}

export function SequenceStepsPanel({
  campaignId,
  sequenceId,
  steps,
  templates,
  attachmentsByStep,
}: {
  campaignId: string;
  sequenceId: string | null;
  steps: SequenceStep[];
  templates: Tables<"templates">[];
  attachmentsByStep: Record<string, Tables<"email_attachments">[]>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SequenceStep | null>(null);
  const [removing, setRemoving] = useState<SequenceStep | null>(null);
  const [isRemoving, startRemoveTransition] = useTransition();
  const [, startMoveTransition] = useTransition();

  const sortedSteps = [...steps].sort((a, b) => a.step_order - b.step_order);
  const stepDays = computeStepDays(sortedSteps);
  const stepNumbers = new Map(sortedSteps.map((step, index) => [step.id, index + 1]));
  function earlierStepsThan(step: SequenceStep | null): EarlierStepOption[] {
    return sortedSteps
      .filter((other) => step === null || other.step_order < step.step_order)
      .map((other) => ({
        id: other.id,
        number: stepNumbers.get(other.id) ?? 0,
        subject: other.subject,
      }));
  }

  function handleRemove() {
    if (!removing) return;
    const target = removing;
    startRemoveTransition(async () => {
      try {
        await deleteSequenceStepAction(campaignId, target.id);
        toast.success("Step removed.");
        setRemoving(null);
      } catch {
        toast.error("Couldn't remove this step.");
      }
    });
  }

  function handleMove(step: SequenceStep, direction: "up" | "down") {
    if (!sequenceId) return;
    startMoveTransition(async () => {
      try {
        await moveSequenceStepAction(campaignId, sequenceId, step.id, direction);
      } catch {
        toast.error("Couldn't reorder steps.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Sequence</CardTitle>
          <CardDescription>
            {steps.length} step{steps.length === 1 ? "" : "s"}. Each lead gets them in order, from the same mailbox,
            within the daily sending limits. Add as many as you need.
          </CardDescription>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <PlusIcon />
              Add step
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-6xl">
            <DialogHeader>
              <DialogTitle>Add a step</DialogTitle>
              <DialogDescription>Added to the end of the sequence.</DialogDescription>
            </DialogHeader>
            <SequenceStepForm
              mode="create"
              campaignId={campaignId}
              templates={templates}
              earlierSteps={earlierStepsThan(null)}
              onSuccess={() => setAddOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">No steps yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add the first email in this sequence to get started.</p>
          </div>
        ) : (
          <ol>
            {sortedSteps.map((step, index) => {
              const stepAttachments = toAttachmentSummaries(attachmentsByStep[step.id]);
              const condition = describeCondition(step, stepNumbers);
              const warning = conditionWarning(step, sortedSteps);
              const isLast = index === sortedSteps.length - 1;
              return (
                <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0 sm:gap-4">
                  {/* The timeline rail: day marker plus a line down to the next step. */}
                  <div className="flex w-14 shrink-0 flex-col items-center">
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums">
                      Day {stepDays.get(step.id) ?? 1}
                    </span>
                    {!isLast && <span aria-hidden className="mt-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 flex-1 rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          Step {index + 1} · {delayLabel(step.day_delay, index === 0)}
                        </p>
                        {condition && (
                          <Badge variant="info" className="mt-2 gap-1">
                            <GitBranchIcon className="size-3" aria-hidden />
                            {condition}
                          </Badge>
                        )}
                        <p className="mt-1 truncate font-medium">{step.subject || "(No subject)"}</p>
                        {step.body && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {composerMarkupToPlainText(step.body)}
                          </p>
                        )}
                        {stepAttachments.length > 0 && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <PaperclipIcon className="size-3" />
                            {stepAttachments.length} attachment
                            {stepAttachments.length === 1 ? "" : "s"}
                          </p>
                        )}
                        {warning && (
                          <p className="mt-2 flex items-start gap-1 text-xs text-warning-foreground">
                            <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                            {warning}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <EmailPreviewDialog
                          subject={step.subject ?? ""}
                          body={step.body ?? ""}
                          attachments={stepAttachments}
                          trigger={
                            <Button variant="ghost" size="icon" aria-label="Preview step">
                              <EyeIcon className="size-4" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Move step up"
                          disabled={index === 0}
                          onClick={() => handleMove(step, "up")}
                        >
                          <ArrowUpIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Move step down"
                          disabled={isLast}
                          onClick={() => handleMove(step, "down")}
                        >
                          <ArrowDownIcon className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Edit step" onClick={() => setEditing(step)}>
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Delete step" onClick={() => setRemoving(step)}>
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Edit step</DialogTitle>
          </DialogHeader>
          {editing && (
            <SequenceStepForm
              mode="edit"
              campaignId={campaignId}
              step={editing}
              templates={templates}
              earlierSteps={earlierStepsThan(editing)}
              existingAttachments={toAttachmentSummaries(attachmentsByStep[editing.id])}
              onSuccess={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this step?</DialogTitle>
            <DialogDescription>This permanently deletes the step from the sequence.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={isRemoving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={isRemoving}>
              {isRemoving ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
