"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FlameIcon, PauseIcon, PlayIcon, PowerIcon, SettingsIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import type { MailboxSafe } from "@/lib/db";
import { daysWarming, forecastNextRamp } from "@/lib/warmup/scheduler";
import type { WarmupStage } from "@/lib/warmup/types";
import type { WarmupPeriodSummary } from "@/lib/warmup/stats";
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

// Configuration state plus what the last 7 days of real placement data say.
function warningsFor(
  profile: WarmupProfile | undefined,
  summary: WarmupPeriodSummary | undefined,
  imapEnabled: boolean,
): string[] {
  if (!profile || profile.status === "disabled") return ["Not warming up"];
  const warnings: string[] = [];
  if (profile.status === "paused") warnings.push("Paused");
  if (!imapEnabled) warnings.push("Enable IMAP so this mailbox can rescue warmup mail from spam");
  if (summary?.inboxRate != null && summary.inboxRate < 80) {
    warnings.push(`Only ${summary.inboxRate}% reached the inbox — hold off on campaigns from this mailbox`);
  }
  return warnings;
}

function placementVariant(rate: number): "success" | "warning" | "destructive" {
  if (rate >= 90) return "success";
  if (rate >= 75) return "warning";
  return "destructive";
}

const DEFAULT_SETTINGS = { targetDailyVolume: 30, rampUpPercent: 20 };

export function WarmupDashboard({
  mailboxes,
  profileByMailbox,
  summaryByProfile = {},
}: {
  mailboxes: MailboxSafe[];
  profileByMailbox: Record<string, WarmupProfile>;
  summaryByProfile?: Record<string, WarmupPeriodSummary>;
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
          Your warmup mailboxes email each other, open, star and reply to that mail, and pull any of it that lands
          in spam back to the inbox, so providers learn to trust them. Inbox % is measured on that warmup mail.
          Warmup doesn&apos;t change what a live campaign sends — the mailbox&apos;s Daily/Hourly limit (under
          Mailboxes) controls that, so keep it conservative while a mailbox is still warming.
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
                    // Same anchor the warmup worker ramps from.
                    lastActivityAt: profile.last_ramp_increase_at ?? profile.started_at,
                  })
                : { nextVolume: null, nextIncreaseAt: null };
              const summary = profile ? summaryByProfile[profile.id] : undefined;
              const warnings = warningsFor(profile, summary, mailbox.imap_enabled);

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
                        {summary?.inboxRate != null && (
                          <Badge variant={placementVariant(summary.inboxRate)}>{summary.inboxRate}% inbox</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {profile?.current_daily_volume ?? 0}/{profile?.target_daily_volume ?? DEFAULT_SETTINGS.targetDailyVolume}
                        {" per day · Days warming: "}
                        {daysWarming(profile?.started_at ?? null)}
                        {" · Next increase: "}
                        {forecast.nextIncreaseAt ? new Date(forecast.nextIncreaseAt).toLocaleDateString() : "—"}
                        {summary && (
                          <>
                            {" · Last 7 days: "}
                            {summary.sent} sent, {summary.received} received, {summary.replies} replies
                            {summary.spam > 0 ? `, ${summary.spam} rescued from spam` : ""}
                          </>
                        )}
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
