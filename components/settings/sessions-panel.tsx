"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LaptopIcon, LogOutIcon, SmartphoneIcon } from "lucide-react";

import { revokeSessionAction, signOutAllSessionsAction } from "@/app/(app)/settings/sessions/actions";
import { signOut } from "@/lib/actions/auth";
import type { DeviceKind } from "@/lib/user-agent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SessionRow = {
  id: string;
  label: string;
  kind: DeviceKind;
  isCurrent: boolean;
  lastActive: string;
  signedIn: string;
};

export function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  const [confirmAll, setConfirmAll] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleLogOut(session: SessionRow) {
    setPendingId(session.id);
    startTransition(async () => {
      try {
        // This browser's own session ends with a normal sign-out, which also
        // clears its cookies and redirects to /login.
        if (session.isCurrent) {
          await signOut();
          return;
        }
        await revokeSessionAction(session.id);
        toast.success(`Logged out ${session.label}.`);
      } catch {
        toast.error("Couldn't log out that session. Try again.");
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleLogOutAll() {
    startTransition(async () => {
      try {
        await signOutAllSessionsAction();
      } catch {
        toast.error("Couldn't log out of all devices. Try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          A logged-out device is signed out the next time it loads a page.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="divide-y divide-border">
          {sessions.map((session) => {
            const Icon = session.kind === "mobile" ? SmartphoneIcon : LaptopIcon;
            return (
              <li key={session.id} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{session.label}</span>
                      {session.isCurrent && <Badge variant="secondary">This device</Badge>}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      Active {session.lastActive} · Signed in {session.signedIn}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLogOut(session)}
                  disabled={isPending}
                  aria-label={`Log out ${session.label}${session.isCurrent ? " (this device)" : ""}`}
                >
                  {pendingId === session.id ? "Logging out…" : "Log out"}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <CardFooter className="justify-end border-t border-border pt-6">
        <Button variant="destructive" onClick={() => setConfirmAll(true)} disabled={isPending}>
          <LogOutIcon className="size-4" aria-hidden="true" />
          Log out of all devices
        </Button>
      </CardFooter>

      <Dialog open={confirmAll} onOpenChange={(open) => !isPending && setConfirmAll(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log out of all devices?</DialogTitle>
            <DialogDescription>
              Every session ends, including this one. You&apos;ll need to sign in again everywhere.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAll(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLogOutAll} disabled={isPending}>
              {isPending ? "Logging out…" : "Log out everywhere"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
