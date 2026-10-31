"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheckIcon } from "lucide-react";
import { signUp } from "@/lib/actions/auth";
import { signUpSchema, type SignUpInput } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion/fade-in";
import { PasswordMatch, PasswordStrength } from "@/components/auth/password-strength";
import { AwaitEmailConfirmation } from "@/components/auth/await-email-confirmation";

export default function SignupPage() {
  const [isPending, startTransition] = useTransition();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // onTouched: a field is checked once the user leaves it, then re-checked on
  // every keystroke, so an error disappears the moment the input is valid.
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    mode: "onTouched",
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });
  const password = useWatch({ control: form.control, name: "password" });
  const confirmPassword = useWatch({ control: form.control, name: "confirmPassword" });

  function onSubmit(values: SignUpInput) {
    setFormError(null);
    startTransition(async () => {
      const formData = new FormData();
      for (const [key, value] of Object.entries(values)) formData.set(key, value);
      const result = await signUp(undefined, formData);

      if (result?.success) {
        setSubmittedEmail(values.email);
        return;
      }
      for (const [field, messages] of Object.entries(result?.fieldErrors ?? {})) {
        if (messages?.[0]) form.setError(field as keyof SignUpInput, { message: messages[0] });
      }
      if (result?.error) setFormError(result.error);
    });
  }

  if (submittedEmail) {
    return (
      <FadeIn>
        <Card className="border-none shadow-none sm:border sm:shadow-sm">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MailCheckIcon className="size-6" />
            </div>
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              We sent a confirmation link to <span className="font-medium text-foreground">{submittedEmail}</span>.
              Keep this tab open — once you click the link, you&apos;ll be signed in here automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <AwaitEmailConfirmation email={submittedEmail} />
            <Link href="/login" className="block text-sm font-medium text-foreground hover:underline">
              Back to sign in
            </Link>
          </CardContent>
        </Card>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <Card className="border-none shadow-none sm:border sm:shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>Start your cold email outreach with Polimatiq.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" placeholder="Jane Cooper" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" placeholder="you@company.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete="new-password"
                        {...field}
                        onChange={(event) => {
                          field.onChange(event);
                          // The match check lives on confirmPassword, so re-run it
                          // when the password it's compared against changes.
                          if (form.getFieldState("confirmPassword").isTouched) void form.trigger("confirmPassword");
                        }}
                      />
                    </FormControl>
                    <PasswordStrength password={password} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <PasswordMatch password={password} confirmPassword={confirmPassword} />
                    {/* Once something is typed, PasswordMatch reports the mismatch live. */}
                    {!confirmPassword && <FormMessage />}
                  </FormItem>
                )}
              />
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Creating account…" : "Create account"}
              </Button>
            </form>
          </Form>
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
