"use client";

import { startTransition, useActionState, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { MailCheckIcon } from "lucide-react";
import { signUp, type AuthActionState } from "@/lib/actions/auth";
import { unmetPasswordRules } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion/fade-in";
import { PasswordInput, PasswordMatchHint, PasswordRequirements } from "@/components/auth/password-requirements";

const initialState: AuthActionState = undefined;

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

export default function SignupPage() {
  const [state, action, pending] = useActionState(signUp, initialState);
  // Controlled fields, submitted through onSubmit rather than the form's
  // `action` prop: React resets a form after every `action` submission,
  // which wiped every field (name and email included) whenever the server
  // rejected a password. Submitting via the action dispatcher keeps what
  // the user typed.
  const [values, setValues] = useState({ fullName: "", email: "", password: "", confirmPassword: "" });
  const [attempted, setAttempted] = useState(false);

  const passwordValid = unmetPasswordRules(values.password).length === 0;
  const passwordsMatch = values.password === values.confirmPassword;

  function update(field: keyof typeof values) {
    return (event: ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [field]: event.target.value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    // Client-side gate only, for instant feedback — signUp re-validates
    // everything on the server regardless.
    if (!passwordValid || !passwordsMatch) return;
    const formData = new FormData(event.currentTarget);
    formData.set("timezone", browserTimezone());
    startTransition(() => action(formData));
  }

  if (state?.success) {
    return (
      <FadeIn>
        <Card className="border-none shadow-none sm:border sm:shadow-sm">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MailCheckIcon className="size-6" />
            </div>
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              We sent a confirmation link to <span className="font-medium text-foreground">{values.email}</span>. Click
              it to activate your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Link href="/login" className="text-sm font-medium text-foreground hover:underline">
              Back to sign in
            </Link>
          </CardContent>
        </Card>
      </FadeIn>
    );
  }

  const passwordError = state?.fieldErrors?.password?.[0];
  const confirmError =
    attempted && values.confirmPassword.length > 0 && !passwordsMatch
      ? "Passwords do not match."
      : state?.fieldErrors?.confirmPassword?.[0];

  return (
    <FadeIn>
      <Card className="border-none shadow-none sm:border sm:shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>Start your cold email outreach with Polimatiq.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                name="fullName"
                autoComplete="name"
                placeholder="Jane Cooper"
                required
                maxLength={120}
                value={values.fullName}
                onChange={update("fullName")}
                aria-invalid={Boolean(state?.fieldErrors?.fullName)}
              />
              {state?.fieldErrors?.fullName && (
                <p className="text-sm text-destructive">{state.fieldErrors.fullName[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                required
                value={values.email}
                onChange={update("email")}
                aria-invalid={Boolean(state?.fieldErrors?.email)}
              />
              {state?.fieldErrors?.email && (
                <p className="text-sm text-destructive">{state.fieldErrors.email[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                required
                maxLength={72}
                value={values.password}
                onChange={update("password")}
                aria-describedby="password-requirements"
                aria-invalid={(attempted && !passwordValid) || Boolean(passwordError)}
              />
              {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            </div>
            <PasswordRequirements id="password-requirements" password={values.password} showUnmet={attempted} />
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
                required
                maxLength={72}
                value={values.confirmPassword}
                onChange={update("confirmPassword")}
                aria-invalid={Boolean(confirmError)}
              />
              {confirmError ? (
                <p className="text-sm text-destructive">{confirmError}</p>
              ) : (
                <PasswordMatchHint password={values.password} confirmPassword={values.confirmPassword} />
              )}
            </div>
            {state?.error && (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Creating account…" : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            By creating an account, you agree to our{" "}
            <Link href="/terms" className="font-medium text-foreground hover:underline">
              Terms of Service
            </Link>
            ,{" "}
            <Link href="/acceptable-use" className="font-medium text-foreground hover:underline">
              Acceptable Use Policy
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium text-foreground hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </FadeIn>
  );
}
