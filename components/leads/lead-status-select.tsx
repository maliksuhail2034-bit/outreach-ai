"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { setLeadsStatusAction } from "@/app/(app)/leads/actions";
import { ActionError, unwrapActionResult } from "@/lib/action-result";
import { leadStatusLabel } from "@/lib/leads/display";
import { LEAD_STATUSES } from "@/lib/validations/leads";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The lead's pipeline status, changeable in place on the lead's page.
export function LeadStatusSelect({ leadId, status }: { leadId: string; status: string }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    startTransition(async () => {
      try {
        unwrapActionResult(await setLeadsStatusAction({ target: { ids: [leadId] }, status: next }));
        toast.success(`Status set to ${leadStatusLabel(next)}.`);
      } catch (error) {
        toast.error(error instanceof ActionError ? error.message : "Couldn't change the status. Try again.");
      }
    });
  }

  return (
    <Select value={status} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger size="sm" className="w-44" aria-label="Lead status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEAD_STATUSES.map((value) => (
          <SelectItem key={value} value={value}>
            {leadStatusLabel(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
