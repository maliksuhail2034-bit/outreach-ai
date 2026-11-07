"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BanIcon, KeyRoundIcon, LogOutIcon, PencilIcon, RotateCcwIcon, ShieldCheckIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";

import type { StaffRole } from "@/lib/db/staff";
import { STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import { staffPasswordRules, usernameProblem } from "@/lib/staff/password-policy";
import {
  changeStaffRoleAction,
  changeStaffUsernameAction,
  deleteStaffAccountAction,
  resetStaffAccessAction,
  setStaffDisabledAction,
  setStaffPasswordAction,
  signOutStaffEverywhereAction,
} from "@/app/console/(panel)/staff/actions";
import { PasswordInput, PasswordRequirements } from "@/components/auth/password-requirements";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupLinkNotice } from "./setup-link-notice";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
type DialogKind = "block" | "password" | "username" | "signout" | "reset" | "delete" | null;

// A strong random password for "set password" (24 characters from every
// class), generated in the browser and never sent anywhere but the action.
function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*-_=+?"];
  const all = sets.join("");
  const random = (max: number) => {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] % max;
  };
  const chars = sets.map((set) => set[random(set.length)]);
  while (chars.length < 24) chars.push(all[random(all.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = random(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join("");
}

export function EmployeeActions({
  staffId,
  displayName,
  username,
  role,
  status,
  assignableRoles,
}: {
  staffId: string;
  displayName: string;
  username: string;
  role: StaffRole;
  status: "invited" | "active" | "disabled";
  assignableRoles: StaffRole[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<DialogKind>(null);
  const [link, setLink] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [newUsername, setNewUsername] = useState(username);
  const [confirmName, setConfirmName] = useState("");
  const blocked = status === "disabled";
  const rules = staffPasswordRules(role);
  const passwordValid = rules.every((rule) => rule.test(password));
  const usernameError = usernameProblem(newUsername);

  function run<T>(work: () => Promise<Result<T>>, success: string, after?: (data: T) => void) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      setOpen(null);
      after?.(result.data);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manage</CardTitle>
        <CardDescription>Every change is recorded in the audit log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {link && <SetupLinkNotice link={link} name={displayName} onDismiss={() => setLink(null)} />}

        <div className="space-y-1.5">
          <Label htmlFor="employee-role">Role</Label>
          <select
            id="employee-role"
            value={role}
            disabled={pending || assignableRoles.length < 2}
            onChange={(event) => run(() => changeStaffRoleAction(staffId, event.target.value as StaffRole), "Role updated. They've been signed out so it applies straight away.")}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {assignableRoles.map((option) => (
              <option key={option} value={option}>
                {STAFF_ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <ActionButton icon={KeyRoundIcon} onClick={() => { setPassword(""); setMustChange(true); setOpen("password"); }} disabled={pending || blocked}>
            Set password
          </ActionButton>
          <ActionButton icon={PencilIcon} onClick={() => { setNewUsername(username); setOpen("username"); }} disabled={pending}>
            Change username
          </ActionButton>
          <ActionButton icon={LogOutIcon} onClick={() => setOpen("signout")} disabled={pending || blocked}>
            Sign out everywhere
          </ActionButton>
          <ActionButton icon={RotateCcwIcon} onClick={() => setOpen("reset")} disabled={pending || blocked}>
            Reset access (new setup link)
          </ActionButton>
          <ActionButton icon={blocked ? ShieldCheckIcon : BanIcon} onClick={() => setOpen("block")} disabled={pending} destructive={!blocked}>
            {blocked ? "Unblock" : "Block"}
          </ActionButton>
          <ActionButton icon={Trash2Icon} onClick={() => { setConfirmName(""); setOpen("delete"); }} disabled={pending} destructive>
            Delete account
          </ActionButton>
        </div>
      </CardContent>

      <Dialog open={open === "password"} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set {displayName}&apos;s password</DialogTitle>
            <DialogDescription>
              Ends all their sessions. Give it to them privately. {STAFF_ROLE_LABELS[role]} accounts need the rules below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <PasswordInput aria-label="New password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
              <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())}>
                <WandSparklesIcon aria-hidden="true" />
                Generate
              </Button>
            </div>
            <PasswordRequirements id="employee-password-rules" password={password} rules={rules} showUnmet={password.length > 0} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={mustChange} onChange={(event) => setMustChange(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
              <span>Make them choose their own password at next sign-in (recommended)</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
            <Button
              disabled={pending || !passwordValid}
              onClick={() => run(() => setStaffPasswordAction({ staffId, password, mustChange }), "Password set. They've been signed out everywhere.", () => setPassword(""))}
            >
              {pending ? "Saving…" : "Set password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "username"} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change username</DialogTitle>
            <DialogDescription>They sign in with the new username from now on. Tell them before you change it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="employee-username">New username</Label>
            <Input id="employee-username" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(usernameError)} aria-describedby="employee-username-help" />
            <p id="employee-username-help" className={usernameError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {usernameError ?? "3-32 characters: letters, numbers, dots, dashes or underscores."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
            <Button disabled={pending || Boolean(usernameError) || newUsername.trim().toLowerCase() === username} onClick={() => run(() => changeStaffUsernameAction(staffId, newUsername), "Username changed.")}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={open === "signout"}
        onClose={() => setOpen(null)}
        title={`Sign ${displayName} out everywhere?`}
        description="Ends every session on every device. They can sign in again straight away (use Block to stop that)."
        confirmLabel="Sign out everywhere"
        pending={pending}
        onConfirm={() => run(() => signOutStaffEverywhereAction(staffId), "Signed out everywhere.")}
      />
      <ConfirmDialog
        open={open === "reset"}
        onClose={() => setOpen(null)}
        title={`Reset ${displayName}'s access?`}
        description="Removes their 2-step login, ends every session and gives you a new one-time setup link. They choose a new password and set up their authenticator again."
        confirmLabel="Reset access"
        pending={pending}
        onConfirm={() => run(() => resetStaffAccessAction(staffId), "Access reset. Hand over the new setup link.", (data) => setLink(data.setupLink))}
      />
      <ConfirmDialog
        open={open === "block"}
        onClose={() => setOpen(null)}
        title={blocked ? `Unblock ${displayName}?` : `Block ${displayName}?`}
        description={
          blocked
            ? "They can sign in again with their existing password and authenticator. If they've lost them, use Reset access after unblocking."
            : "Refuses every sign-in and ends all their sessions immediately. Their history stays. You can unblock them later."
        }
        confirmLabel={blocked ? "Unblock" : "Block"}
        destructive={!blocked}
        pending={pending}
        onConfirm={() => run(() => setStaffDisabledAction(staffId, !blocked), blocked ? "Unblocked." : "Blocked and signed out everywhere.")}
      />

      <Dialog open={open === "delete"} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {displayName}&apos;s account?</DialogTitle>
            <DialogDescription>
              Permanently removes their login and work-time history. This can&apos;t be undone. What they did stays in the audit
              log. To pause access instead, use Block.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-username">
              Type <span className="font-mono">{username}</span> to confirm
            </Label>
            <Input id="confirm-username" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoCapitalize="none" spellCheck={false} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending || confirmName.trim().toLowerCase() !== username}
              onClick={() =>
                run(() => deleteStaffAccountAction(staffId, confirmName), "Account deleted.", () => router.push("/console/staff"))
              }
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ActionButton({
  icon: Icon,
  children,
  destructive = false,
  ...props
}: { icon: typeof KeyRoundIcon; children: ReactNode; destructive?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant={destructive ? "destructive" : "outline"} className="justify-start" {...props}>
      <Icon aria-hidden="true" />
      {children}
    </Button>
  );
}

function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
