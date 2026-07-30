"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import type { Tables } from "@/types/database.types";
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
import { SequenceStepForm } from "./sequence-step-form";

type SequenceStep = Tables<"sequence_steps">;

function delayLabel(dayDelay: number) {
  if (dayDelay === 0) return "Same day";
  return `+${dayDelay} day${dayDelay === 1 ? "" : "s"}`;
}

export function SequenceStepsPanel({
  campaignId,
  sequenceId,
  steps,
  templates,
}: {
  campaignId: string;
  sequenceId: string | null;
  steps: SequenceStep[];
  templates: Tables<"templates">[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SequenceStep | null>(null);
  const [removing, setRemoving] = useState<SequenceStep | null>(null);
  const [isRemoving, startRemoveTransition] = useTransition();
  const [, startMoveTransition] = useTransition();

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
            {steps.length} step{steps.length === 1 ? "" : "s"} in this sequence.
          </CardDescription>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <PlusIcon />
              Add step
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a step</DialogTitle>
              <DialogDescription>Appended to the end of the sequence.</DialogDescription>
            </DialogHeader>
            <SequenceStepForm
              mode="create"
              campaignId={campaignId}
              templates={templates}
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
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      Step {index + 1} · {delayLabel(step.day_delay)}
                    </p>
                    <p className="mt-1 truncate font-medium">{step.subject || "(No subject)"}</p>
                    {step.body && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{step.body}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
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
                      disabled={index === steps.length - 1}
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
              </li>
            ))}
          </ol>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit step</DialogTitle>
          </DialogHeader>
          {editing && (
            <SequenceStepForm
              mode="edit"
              campaignId={campaignId}
              step={editing}
              templates={templates}
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
