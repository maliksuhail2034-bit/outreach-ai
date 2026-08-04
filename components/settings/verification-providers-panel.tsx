"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BadgeCheckIcon, PlusIcon, Trash2Icon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { disconnectVerificationProviderKeyAction } from "@/app/(app)/settings/verification/actions";
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
import { VerificationProviderKeyForm } from "./verification-provider-key-form";

type VerificationProviderKey = Tables<"verification_provider_keys">;

const PROVIDER_LABEL: Record<string, string> = {
  millionverifier: "MillionVerifier",
};

// Presentational + the thin client-side glue (useTransition, toast) every
// other settings list in this app already follows (see
// components/settings/ai-providers-panel.tsx). No API key is ever sent to
// or rendered by this component in full — only key_preview.
export function VerificationProvidersPanel({ providerKeys }: { providerKeys: VerificationProviderKey[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<VerificationProviderKey | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startDeleteTransition(async () => {
      try {
        await disconnectVerificationProviderKeyAction(target.id);
        toast.success("API key disconnected.");
        setDeleting(null);
      } catch {
        toast.error("Couldn't disconnect the key. Try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Connected verification providers</CardTitle>
          <CardDescription>Bring your own API key — outreach-ai never provides managed verification credit.</CardDescription>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <PlusIcon />
              Connect key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Connect an API key</DialogTitle>
              <DialogDescription>
                Used whenever you verify a lead, either directly or via the bulk verification queue.
              </DialogDescription>
            </DialogHeader>
            <VerificationProviderKeyForm onSuccess={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {providerKeys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <BadgeCheckIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No verification provider connected yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect a MillionVerifier API key to start verifying leads.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {providerKeys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate font-medium">{PROVIDER_LABEL[key.provider] ?? key.provider}</p>
                  <p className="truncate text-sm text-muted-foreground">{key.key_preview}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Disconnect ${PROVIDER_LABEL[key.provider] ?? key.provider}`}
                  onClick={() => setDeleting(key)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect API key?</DialogTitle>
            <DialogDescription>
              You won&apos;t be able to verify new leads with this provider until you reconnect a key. Leads already
              verified keep their last result.
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
