"use client";

import { useState, type ComponentProps } from "react";
import { CheckCircle2Icon, CircleIcon, EyeIcon, EyeOffIcon, XCircleIcon } from "lucide-react";

import { PASSWORD_RULES } from "@/lib/validations/auth";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// The password policy, always visible between "Password" and "Confirm
// password" and ticked off live as the user types. Each rule pairs an icon
// with its text (met / not met), so the state never relies on color alone.
// `showUnmet` flips unmet rules from neutral to an explicit error once the
// user has tried to submit.
export function PasswordRequirements({
  id,
  password,
  showUnmet = false,
  rules = PASSWORD_RULES,
}: {
  id: string;
  password: string;
  showUnmet?: boolean;
  // A stricter policy (e.g. staff accounts); defaults to the customer rules.
  rules?: readonly { id: string; label: string; test: (value: string) => boolean }[];
}) {
  return (
    <div id={id} className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">Your password must contain:</p>
      <ul className="mt-1.5 grid gap-1 sm:grid-cols-2" aria-live="polite">
        {rules.map((rule) => {
          const met = rule.test(password);
          const failed = !met && showUnmet;
          const Icon = met ? CheckCircle2Icon : failed ? XCircleIcon : CircleIcon;
          return (
            <li
              key={rule.id}
              className={cn(
                "flex items-center gap-1.5 text-xs",
                met ? "text-success" : failed ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {rule.label}
                <span className="sr-only">{met ? " — met" : " — not met yet"}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Live "passwords match" feedback under the confirm field. Silent until the
// user has typed something into it, so it doesn't shout before they start.
export function PasswordMatchHint({ password, confirmPassword }: { password: string; confirmPassword: string }) {
  if (confirmPassword.length === 0) return null;
  const matches = password === confirmPassword;
  const Icon = matches ? CheckCircle2Icon : XCircleIcon;
  return (
    <p
      className={cn("flex items-center gap-1.5 text-xs", matches ? "text-success" : "text-destructive")}
      aria-live="polite"
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {matches ? "Passwords match" : "Passwords don't match yet"}
    </p>
  );
}

// Password field with a show/hide toggle — lets the user check what they
// typed instead of retyping both fields after a mismatch.
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-10", className)} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOffIcon className="size-4" aria-hidden="true" /> : <EyeIcon className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
