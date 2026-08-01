"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MailIcon, RefreshCwIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import type { MailboxSafe } from "@/lib/db";
import { recalculateMailboxHealthAction } from "@/app/(app)/settings/deliverability/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBadge } from "./score-badge";

type MailboxHealth = Tables<"mailbox_health">;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  paused: "secondary",
  error: "destructive",
};

const WARMUP_LABEL: Record<string, string> = {
  not_started: "Not started",
  warming: "Warming",
  warmed: "Warmed",
  paused: "Paused",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function percentLabel(value: number | null | undefined) {
  return value == null ? "Not measured" : `${value}%`;
}

export function MailboxHealthList({
  mailboxes,
  healthByMailbox,
}: {
  mailboxes: MailboxSafe[];
  healthByMailbox: Record<string, MailboxHealth>;
}) {
  const [recalculatingId, setRecalculatingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRecalculate(mailboxId: string) {
    setRecalculatingId(mailboxId);
    startTransition(async () => {
      try {
        await recalculateMailboxHealthAction(mailboxId);
        toast.success("Mailbox health recalculated.");
      } catch {
        toast.error("Couldn't recalculate health. Try again.");
      } finally {
        setRecalculatingId(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mailbox health</CardTitle>
        <CardDescription>
          Reputation, bounce/reply rate, and warmup status per mailbox. Populated by future warmup and reputation
          integrations — the score below reflects whatever is known today.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {mailboxes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <MailIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No mailboxes connected yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Connect a mailbox to start tracking its health.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {mailboxes.map((mailbox) => {
              const health = healthByMailbox[mailbox.id];
              const warmupStatus = health?.warmup_status ?? "not_started";
              return (
                <li key={mailbox.id} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{mailbox.display_name || mailbox.email}</p>
                      <Badge variant={STATUS_VARIANT[mailbox.status] ?? "outline"}>
                        {statusLabel(mailbox.status)}
                      </Badge>
                      <Badge variant="outline">{WARMUP_LABEL[warmupStatus] ?? warmupStatus}</Badge>
                      <ScoreBadge score={health?.health_score ?? 0} />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {mailbox.daily_limit}/day · Reputation:{" "}
                      {health?.reputation_score == null ? "Not measured" : health.reputation_score}
                      {" · Bounce: "}
                      {percentLabel(health?.bounce_rate)}
                      {" · Reply: "}
                      {percentLabel(health?.reply_rate)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Recalculate health for ${mailbox.email}`}
                    disabled={isPending && recalculatingId === mailbox.id}
                    onClick={() => handleRecalculate(mailbox.id)}
                  >
                    <RefreshCwIcon
                      className={recalculatingId === mailbox.id && isPending ? "size-4 animate-spin" : "size-4"}
                    />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
