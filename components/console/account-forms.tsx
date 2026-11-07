"use client";

import { startTransition, useActionState, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { changeOwnUsernameAction, setOwnPasswordAction, type OwnPasswordState } from "@/app/console/account/actions";
import { staffPasswordRules, usernameProblem, type StaffRoleName } from "@/lib/staff/password-policy";
import { PasswordInput, PasswordMatchHint, PasswordRequirements } from "@/components/auth/password-requirements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OwnPasswordForm({ role, submitLabel }: { role: StaffRoleName; submitLabel: string }) {
  const [state, action, pending] = useActionState<OwnPasswordState, FormData>(setOwnPasswordAction, undefined);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [attempted, setAttempted] = useState(false);
  const rules = staffPasswordRules(role);
  const valid = rules.every((rule) => rule.test(password));
  const matches = password === confirmPassword;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (!valid || !matches) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <PasswordInput
          id="new-password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby="staff-password-rules"
          aria-invalid={attempted && !valid}
          required
        />
      </div>
      <PasswordRequirements id="staff-password-rules" password={password} showUnmet={attempted} rules={rules} />
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <PasswordInput
          id="confirm-password"
          name="confirmPassword"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={attempted && !matches}
          required
        />
        {confirmPassword.length > 0 && <PasswordMatchHint password={password} confirmPassword={confirmPassword} />}
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

export function OwnUsernameForm({ username: current }: { username: string }) {
  const [pending, startSave] = useTransition();
  const [username, setUsername] = useState(current);
  const [saved, setSaved] = useState(current);
  const problem = username.trim() ? usernameProblem(username) : "Enter a username.";
  const dirty = username.trim().toLowerCase() !== saved;

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem || !dirty) return;
        startSave(async () => {
          const result = await changeOwnUsernameAction(username);
          if (!result.ok) toast.error(result.error);
          else {
            setSaved(result.data.username);
            setUsername(result.data.username);
            toast.success(`Your username is now ${result.data.username}. Use it next time you sign in.`);
          }
        });
      }}
    >
      <Label htmlFor="own-username">Username</Label>
      <div className="flex gap-2">
        <Input
          id="own-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          spellCheck={false}
          aria-invalid={dirty && Boolean(problem)}
          aria-describedby="own-username-help"
        />
        <Button type="submit" variant="outline" disabled={pending || !dirty || Boolean(problem)}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p id="own-username-help" className={dirty && problem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {dirty && problem ? problem : "You sign in with this, not your email. 3-32 characters: letters, numbers, dots, dashes, underscores."}
      </p>
    </form>
  );
}
