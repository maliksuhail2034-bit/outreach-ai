"use client";

import { useActionState } from "react";
import { LogInIcon } from "lucide-react";

import { staffSignInAction, type StaffSignInState } from "@/app/console/session-actions";
import { PasswordInput } from "@/components/auth/password-requirements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StaffSignInForm() {
  const [state, action, pending] = useActionState<StaffSignInState, FormData>(staffSignInAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="staff-username">Username</Label>
        <Input id="staff-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="staff-password">Password</Label>
        <PasswordInput id="staff-password" name="password" autoComplete="current-password" required />
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        <LogInIcon aria-hidden="true" />
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
