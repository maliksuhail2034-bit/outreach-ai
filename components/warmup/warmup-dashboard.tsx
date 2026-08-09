"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FlameIcon, PauseIcon, PlayIcon, PowerIcon, SettingsIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import type { MailboxSafe } from "@/lib/db";
import { daysWarming, forecastNextRamp } from "@/lib/warmup/scheduler";
import type { WarmupStage } from "@/lib/warmup/types";
import { disableWarmupAction, pauseWarmupAction } from "@/app/(app)/warmup/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WarmupSettingsForm } from "./warmup-settings-form";

type WarmupProfile = Tables<"warmup_profiles">;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  enabled: "default",
  paused: "secondary",
  disabled: "outline",
};

const STAGE_LABEL: Record<WarmupStage, string> = {
  disabled: "Disabled",
  starting: "Starting",
  warming: "Warming",
  healthy: "Healthy",
  cooling: "Cooling",
  paused: "Paused",
};

function scoreVariant(score: number): "success" | "warning" | "destructive" {
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "destructive";
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Structural warnings only — no fabricated statistics. A profile with real
// stats (see warmup_stats) will have more to say here once a future stats
// worker populates them; today this just reflects configuration state.
function warningsFor(profile: WarmupProfile | undefined): string[] {
  if (!profile || profile.status === "disabled") return ["Not warming up"];
  if (profile.status === "paused") return ["Paused"];
  return [];
}

const DEFAULT_SETTINGS = { targetDailyVolume: 30, rampUpPercent: 20 };

export function WarmupDashboard({
  mailboxes,
  profileByMailbox,
}: {
  mailboxes: MailboxSafe[];
  profileByMailbox: Record<string, WarmupProfile>;
}) {
  const [dialogMailboxId, setDialogMailboxId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"enable" | "settings">("enable");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openEnableDialog(mailboxId: string) {
    setDialogMailboxId(mailboxId);
    setDialogMode("enable");
  }

  function openSettingsDialog(mailboxId: string) {
    setDialogMailboxId(mailboxId);
    setDialogMode("settings");
  }

  function handlePause(mailboxId: string) {
    setPendingId(mailboxId);
    startTransition(async () => {
      try {
        await pauseWarmupAction(mailboxId);
        toast.success("Warmup paused.");
      } catch {
        toast.error("Couldn't pause warmup. Try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleDisable(mailboxId: string) {
    setPendingId(mailboxId);
    startTransition(async () => {
      try {
        await disableWarmupAction(mailboxId);
        toast.success("Warmup disabled.");
      } catch {
        toast.error("Couldn't disable warmup. Try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  const dialogMailbox = mailboxes.find((mailbox) => mailbox.id === dialogMailboxId);
  const dialogProfile = dialogMailboxId ? profileByMailbox[dialogMailboxId] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mailbox warmup</CardTitle>
        <CardDescription>
          Ramp sending volume gradually to build inbox reputation before real campaigns. This doesn&apos;t yet
          change what a live campaign actually sends — a mailbox&apos;s Daily/Hourly limit (set when connecting
          it, under Mailboxes) is what controls that today, so set a conservative one for a new mailbox.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {mailboxes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <FlameIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No mailboxes connected yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Connect a mailbox to start warming it up.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {mailboxes.map((mailbox) => {
              const profile = profileByMailbox[mailbox.id];
              const status = profile?.status ?? "disabled";
              const stage = (profile?.stage ?? "disabled") as WarmupStage;
              const forecast = profile
                ? forecastNextRamp({
                    stage,
                    targetDailyVolume: profile.target_daily_volume,
                    currentDailyVolume: profile.current_daily_volume,
                    rampUpPercent: profile.ramp_up_percent,
                    lastActivityAt: profile.last_activity_at,
                  })
                : { nextVolume: null, nextIncreaseAt: null };
              const warnings = warningsFor(profile);

              return (
                <li key={mailbox.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{mailbox.display_name || mailbox.email}</p>
                        <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{statusLabel(status)}</Badge>
                        <Badge variant="outline">{STAGE_LABEL[stage]}</Badge>
                        <Badge variant={scoreVariant(profile?.health_score ?? 0)}>
                          {profile?.health_score ?? 0}/100
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {profile?.current_daily_volume ?? 0}/{profile?.target_daily_volume ?? DEFAULT_SETTINGS.targetDailyVolume}
                        {" per day · Days warming: "}
                        {daysWarming(profile?.started_at ?? null)}
                        {" · Next increase: "}
                        {forecast.nextIncreaseAt ? new Date(forecast.nextIncreaseAt).toLocaleDateString() : "—"}
                        {warnings.length > 0 && (
                          <>
                            {" · "}
                            <span className="text-warning">{warnings.join(", ")}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {status === "enabled" ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Pause warmup for ${mailbox.email}`}
                            disabled={isPending && pendingId === mailbox.id}
                            onClick={() => handlePause(mailbox.id)}
                          >
                            <PauseIcon className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Open warmup settings for ${mailbox.email}`}
                            onClick={() => openSettingsDialog(mailbox.id)}
                          >
                            <SettingsIcon className="size-4" />
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" onClick={() => openEnableDialog(mailbox.id)}>
                          <PlayIcon />
                          {status === "paused" ? "Resume" : "Enable"}
                        </Button>
                      )}
                      {status !== "disabled" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Disable warmup for ${mailbox.email}`}
                          disabled={isPending && pendingId === mailbox.id}
                          onClick={() => handleDisable(mailbox.id)}
                        >
                          <PowerIcon className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={dialogMailboxId !== null} onOpenChange={(open) => !open && setDialogMailboxId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode === "enable" ? "Enable warmup" : "Warmup settings"}</DialogTitle>
            <DialogDescription>
              {dialogMailbox ? `Configure warmup for ${dialogMailbox.email}.` : ""}
            </DialogDescription>
          </DialogHeader>
          {dialogMailboxId && (
            <WarmupSettingsForm
              mailboxId={dialogMailboxId}
              mode={dialogMode}
              defaultValues={{
                targetDailyVolume: dialogProfile?.target_daily_volume ?? DEFAULT_SETTINGS.targetDailyVolume,
                rampUpPercent: dialogProfile?.ramp_up_percent ?? DEFAULT_SETTINGS.rampUpPercent,
              }}
              onSuccess={() => setDialogMailboxId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
