"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon } from "lucide-react";
import { resetPassword } from "@/lib/actions/auth";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion/fade-in";
import { PasswordMatch, PasswordStrength } from "@/components/auth/password-strength";

export function ResetPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onTouched",
    defaultValues: { password: "", confirmPassword: "", signOutOthers: true },
  });
  const password = useWatch({ control: form.control, name: "password" });
  const confirmPassword = useWatch({ control: form.control, name: "confirmPassword" });

  function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    startTransition(async () => {
      const formData = new FormData();
      for (const [key, value] of Object.entries(values)) formData.set(key, String(value));
      // Redirects to the dashboard on success, so only failures come back.
      const result = await resetPassword(undefined, formData);

      for (const [field, messages] of Object.entries(result?.fieldErrors ?? {})) {
        if (messages?.[0]) form.setError(field as keyof ResetPasswordInput, { message: messages[0] });
      }
      if (result?.error) setFormError(result.error);
    });
  }

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
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete="new-password"
                        {...field}
                        onChange={(event) => {
                          field.onChange(event);
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
                    <FormLabel>Confirm new password</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <PasswordMatch password={password} confirmPassword={confirmPassword} />
                    {/* Once something is typed, PasswordMatch reports the mismatch live. */}
                    {!confirmPassword && <FormMessage />}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="signOutOthers"
                render={({ field }) => (
                  <FormItem className="flex items-start gap-2 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                        checked={field.value}
                        onChange={(event) => field.onChange(event.target.checked)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormLabel className="text-sm font-normal leading-snug">
                      Log out of all other devices
                    </FormLabel>
                  </FormItem>
                )}
              />
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Updating…" : "Update password"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </FadeIn>
  );
}
