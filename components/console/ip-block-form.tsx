"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { blockIpAction, unblockIpAction } from "@/app/console/(panel)/security/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DURATIONS = [
  { value: "24", label: "24 hours" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
  { value: "permanent", label: "Until removed" },
] as const;

export function IpBlockForm({ defaultCidr = "", compact = false }: { defaultCidr?: string; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [cidr, setCidr] = useState(defaultCidr);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<string>("168");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await blockIpAction({
        cidr,
        reason,
        expiresInHours: duration === "permanent" ? undefined : Number(duration),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${cidr} blocked.`);
      if (!defaultCidr) setCidr("");
      setReason("");
    });
  }

  return (
    <form onSubmit={submit} className={compact ? "flex flex-wrap items-end gap-2" : "grid gap-4 sm:grid-cols-2"}>
      {!defaultCidr && (
        <div className="space-y-1.5">
          <Label htmlFor="ip-block-cidr">Address or range</Label>
          <Input id="ip-block-cidr" required value={cidr} onChange={(event) => setCidr(event.target.value)} placeholder="203.0.113.7 or 203.0.113.0/24" />
        </div>
      )}
      <div className="min-w-48 flex-1 space-y-1.5">
        <Label htmlFor={`ip-block-reason-${defaultCidr || "new"}`}>Reason</Label>
        <Input
          id={`ip-block-reason-${defaultCidr || "new"}`}
          required
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Password guessing against customer accounts"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`ip-block-duration-${defaultCidr || "new"}`}>For</Label>
        <Select value={duration} onValueChange={setDuration}>
          <SelectTrigger id={`ip-block-duration-${defaultCidr || "new"}`} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={compact ? "" : "flex items-end"}>
        <Button type="submit" disabled={pending}>
          {pending ? "Blocking…" : defaultCidr ? `Block ${defaultCidr}` : "Block"}
        </Button>
      </div>
    </form>
  );
}

export function UnblockIpButton({ id, cidr }: { id: string; cidr: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Remove the block on ${cidr}?`)) return;
        startTransition(async () => {
          const result = await unblockIpAction(id);
          if (!result.ok) toast.error(result.error);
          else toast.success(`${cidr} unblocked.`);
        });
      }}
    >
      Remove
    </Button>
  );
}
