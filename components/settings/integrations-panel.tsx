"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon, SendIcon, Trash2Icon, WebhookIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import {
  deleteIntegrationAction,
  sendTestDigestAction,
  toggleIntegrationAction,
} from "@/app/(app)/settings/integrations/actions";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { WebhookIntegrationForm } from "./webhook-integration-form";

type Integration = Tables<"integrations">;

const PROVIDER_LABEL: Record<string, string> = {
  webhook: "Webhook",
};

function lastSentLabel(integration: Integration): string {
  if (!integration.last_sent_at) return "Never sent";
  const when = new Date(integration.last_sent_at).toLocaleString();
  return integration.last_status === "failed" ? `Failed at ${when}` : `Sent ${when}`;
}

// Presentational + the thin client-side glue (useTransition, toast) every
// other settings list in this app already follows (see
// components/deliverability/domain-health-list.tsx) — every value shown
// here is computed entirely server-side by the integrations Server
// Functions; this component only renders and confirms destructive actions.
export function IntegrationsPanel({ integrations }: { integrations: Integration[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<Integration | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isToggling, startToggleTransition] = useTransition();
  const [isTesting, startTestTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleToggle(integration: Integration, enabled: boolean) {
    setPendingId(integration.id);
    startToggleTransition(async () => {
      try {
        await toggleIntegrationAction(integration.id, enabled);
      } catch {
        toast.error("Couldn't update the integration. Try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleTest(integration: Integration) {
    setPendingId(integration.id);
    startTestTransition(async () => {
      try {
        await sendTestDigestAction(integration.id);
        toast.success("Test digest sent.");
      } catch {
        toast.error("Delivery failed — check the destination and try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startDeleteTransition(async () => {
      try {
        await deleteIntegrationAction(target.id);
        toast.success("Integration disconnected.");
        setDeleting(null);
      } catch {
        toast.error("Couldn't disconnect the integration. Try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            Connect a destination to receive a periodic organization digest — overview metrics and AI Insights.
          </CardDescription>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <PlusIcon />
              Connect webhook
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Connect a webhook</DialogTitle>
              <DialogDescription>
                Enter an https URL that can receive a JSON POST on a schedule.
              </DialogDescription>
            </DialogHeader>
            <WebhookIntegrationForm onSuccess={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {integrations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <WebhookIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No integrations connected yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect a webhook to start receiving your organization&apos;s digest.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {integrations.map((integration) => {
              const isPending = pendingId === integration.id && (isToggling || isTesting);
              return (
                <li key={integration.id} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{PROVIDER_LABEL[integration.provider] ?? integration.provider}</p>
                      <Badge variant={integration.status === "enabled" ? "default" : "secondary"}>
                        {integration.status === "enabled" ? "Enabled" : "Disabled"}
                      </Badge>
                      {integration.last_status && (
                        <Badge variant={integration.last_status === "failed" ? "destructive" : "outline"}>
                          {lastSentLabel(integration)}
                        </Badge>
                      )}
                    </div>
                    {integration.last_error && (
                      <p className="truncate text-sm text-destructive">{integration.last_error}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={integration.status === "enabled"}
                      disabled={isPending}
                      onCheckedChange={(checked) => handleToggle(integration, checked)}
                      aria-label={`${integration.status === "enabled" ? "Disable" : "Enable"} ${PROVIDER_LABEL[integration.provider] ?? integration.provider}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Send test digest"
                      disabled={isPending}
                      onClick={() => handleTest(integration)}
                    >
                      <SendIcon className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Disconnect integration"
                      onClick={() => setDeleting(integration)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect integration?</DialogTitle>
            <DialogDescription>
              This stops sending the organization digest to this destination. You can reconnect it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
