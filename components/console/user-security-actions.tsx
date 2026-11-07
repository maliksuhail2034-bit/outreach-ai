"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { lockUserAction, signOutEverywhereAction, unlockUserAction } from "@/app/console/(panel)/security/actions";
import { Button } from "@/components/ui/button";

export function UserSecurityActions({
  userId,
  email,
  locked,
  canAct,
}: {
  userId: string;
  email: string;
  locked: boolean;
  // False for the operator's own account and accounts their role can't
  // manage; the server re-checks either way.
  canAct: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (!canAct) return <span className="text-xs text-muted-foreground">—</span>;

  function run(confirmText: string, work: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, success: string) {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await work();
      if (!result.ok) toast.error(result.error);
      else toast.success(success);
    });
  }

  return (
    <div className="flex justify-end gap-1.5">
      {locked ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(`Unlock ${email}? They'll be able to sign in again.`, () => unlockUserAction(userId), "Account unlocked.")}
        >
          Unlock
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              `Lock ${email}? Sign-in is refused and every session is ended until someone unlocks the account.`,
              () => lockUserAction(userId),
              "Account locked and signed out everywhere.",
            )
          }
        >
          Lock
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          run(`Sign ${email} out on every device?`, () => signOutEverywhereAction(userId), "Signed out everywhere.")
        }
      >
        Sign out everywhere
      </Button>
    </div>
  );
}
