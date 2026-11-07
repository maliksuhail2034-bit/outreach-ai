"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { KeyRoundIcon } from "lucide-react";
import { resetPassword, type AuthActionState } from "@/lib/actions/auth";
import { unmetPasswordRules } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion/fade-in";
import { PasswordInput, PasswordMatchHint, PasswordRequirements } from "@/components/auth/password-requirements";

const initialState: AuthActionState = undefined;

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPassword, initialState);
  // Controlled + submitted via onSubmit so a rejected attempt doesn't wipe
  // both fields (see app/(auth)/signup/page.tsx for the same pattern).
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [attempted, setAttempted] = useState(false);

  const passwordValid = unmetPasswordRules(password).length === 0;
  const passwordsMatch = password === confirmPassword;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (!passwordValid || !passwordsMatch) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  const passwordError = state?.fieldErrors?.password?.[0];
  const confirmError =
    attempted && confirmPassword.length > 0 && !passwordsMatch
      ? "Passwords do not match."
      : state?.fieldErrors?.confirmPassword?.[0];

  return (
    <FadeIn>
      <Card className="border-none shadow-none sm:border sm:shadow-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRoundIcon className="size-6" />
          </div>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>Choose a strong password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                required
                maxLength={72}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="password-requirements"
                aria-invalid={(attempted && !passwordValid) || Boolean(passwordError)}
              />
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>
            <PasswordRequirements id="password-requirements" password={password} showUnmet={attempted} />
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
                required
                maxLength={72}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-invalid={Boolean(confirmError)}
              />
              {confirmError ? (
                <p className="text-sm text-destructive">{confirmError}</p>
              ) : (
                <PasswordMatchHint password={password} confirmPassword={confirmPassword} />
              )}
            </div>
            {state?.error && (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </FadeIn>
  );
}
