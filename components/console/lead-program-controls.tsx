"use client";

import { useState, useTransition } from "react";
import { PlayIcon } from "lucide-react";
import { toast } from "sonner";

import { runAllocationNowAction, updatePlanLeadQuotaAction } from "@/app/console/(panel)/lead-program/actions";
import type { PlanLeadQuotaInput } from "@/lib/validations/staff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PlanQuotaEditor({
  planId,
  planName,
  leadsPerMonth,
}: {
  planId: PlanLeadQuotaInput["planId"];
  planName: string;
  leadsPerMonth: number;
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(String(leadsPerMonth));
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000;
  const dirty = valid && parsed !== leadsPerMonth;
  const inputId = `quota-${planId}`;

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty) return;
        startTransition(async () => {
          const result = await updatePlanLeadQuotaAction({ planId, leadsPerMonth: parsed });
          if (!result.ok) toast.error(result.error);
          else toast.success(`${planName}: ${parsed.toLocaleString()} leads a month.`);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={inputId} className="sr-only">
          Leads per month for {planName}
        </Label>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={100_000}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={!valid}
          className="w-32 tabular-nums"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !dirty}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function RunAllocationButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await runAllocationNowAction();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          const summary = result.data;
          const problems = [
            summary.shortfalls > 0 ? `pool ran short for ${summary.shortfalls}` : null,
            summary.failed > 0 ? `${summary.failed} failed` : null,
          ].filter(Boolean);
          const message = `Delivered ${summary.delivered.toLocaleString()} leads to ${summary.eligible} paying organization(s).`;
          if (problems.length > 0) toast.warning(`${message} ${problems.join("; ")}.`);
          else toast.success(message);
        })
      }
    >
      <PlayIcon aria-hidden="true" />
      {pending ? "Running…" : "Run allocation now"}
    </Button>
  );
}
