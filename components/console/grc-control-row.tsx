"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateGrcControlAction } from "@/app/console/(panel)/security/actions";
import type { GrcControlUpdateInput } from "@/lib/validations/staff";
import { GRC_STATUS_LABELS } from "@/lib/security/grc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type GrcStatus = GrcControlUpdateInput["status"];

export function GrcControlEditor({
  id,
  status: initialStatus,
  notes: initialNotes,
  canEdit,
}: {
  id: string;
  status: GrcStatus;
  notes: string;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<GrcStatus>(initialStatus);
  const [notes, setNotes] = useState(initialNotes);
  const dirty = status !== initialStatus || notes !== initialNotes;

  if (!canEdit) {
    return notes ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{notes}</p> : null;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`grc-status-${id}`}>Status</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as GrcStatus)}>
            <SelectTrigger id={`grc-status-${id}`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(GRC_STATUS_LABELS) as GrcStatus[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {GRC_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            startTransition(async () => {
              const result = await updateGrcControlAction({ id, status, notes });
              if (!result.ok) toast.error(result.error);
              else toast.success("Saved.");
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`grc-notes-${id}`}>Notes / evidence</Label>
        <Textarea id={`grc-notes-${id}`} rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </div>
  );
}
