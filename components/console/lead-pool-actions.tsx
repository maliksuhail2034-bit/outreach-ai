"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { setVerifiedLeadStatusAction } from "@/app/console/(panel)/sales/actions";
import { Button } from "@/components/ui/button";

export function LeadPoolRowActions({ id, status, email }: { id: string; status: string; email: string }) {
  const [pending, startTransition] = useTransition();

  function change(next: "active" | "retired" | "suppressed", confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await setVerifiedLeadStatusAction([id], next);
      if (!result.ok) toast.error(result.error);
      else if (result.data.changed === 0) toast.error("Nothing changed — the lead's status may have changed meanwhile.");
      else toast.success("Updated.");
    });
  }

  if (status === "suppressed") return <span className="text-xs text-muted-foreground">Opted out</span>;

  return (
    <div className="flex justify-end gap-1.5">
      {status === "active" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => change("retired")}>
          Retire
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => change("active")}>
          Reactivate
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          change(
            "suppressed",
            `Record an opt-out for ${email}? It's removed from every future delivery and every pending send, for all customers. This can't be undone here.`,
          )
        }
      >
        Opt out
      </Button>
    </div>
  );
}
