import { CheckIcon, XIcon } from "lucide-react";

import { PASSWORD_RULES } from "@/lib/validations/auth";
import { cn } from "@/lib/utils";

const LEVELS = [
  { label: "Weak", bar: "bg-destructive", text: "text-destructive" },
  { label: "Moderate", bar: "bg-warning", text: "text-warning" },
  { label: "Strong", bar: "bg-success", text: "text-success" },
] as const;

function getLevel(password: string) {
  const passed = PASSWORD_RULES.filter((rule) => rule.test(password)).length;
  if (passed < PASSWORD_RULES.length) return passed >= 3 ? 1 : 0;
  // Every rule met: long passwords are the ones that are actually strong.
  return password.length >= 12 ? 2 : 1;
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) {
    return (
      <p className="text-xs text-muted-foreground">
        Use 8+ characters with uppercase and lowercase letters, a number and a special character.
      </p>
    );
  }

  const levelIndex = getLevel(password);
  const level = LEVELS[levelIndex];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {LEVELS.map((segment, index) => (
            <div
              key={segment.label}
              className={cn("h-1.5 flex-1 rounded-full", index <= levelIndex ? level.bar : "bg-muted")}
            />
          ))}
        </div>
        <span className={cn("text-xs font-medium", level.text)} aria-live="polite">
          {level.label}
        </span>
      </div>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <li key={rule.id} className={cn("flex items-center gap-1.5", met ? "text-success" : "text-muted-foreground")}>
              {met ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <XIcon className="size-3.5" aria-hidden="true" />}
              <span>
                <span className="sr-only">{met ? "Done: " : "Missing: "}</span>
                {rule.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PasswordMatch({ password, confirmPassword }: { password: string; confirmPassword: string }) {
  if (!confirmPassword) return null;
  const matches = password === confirmPassword;

  return (
    <p
      className={cn("flex items-center gap-1.5 text-xs font-medium", matches ? "text-success" : "text-destructive")}
      aria-live="polite"
    >
      {matches ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <XIcon className="size-3.5" aria-hidden="true" />}
      {matches ? "Passwords match" : "Passwords don't match"}
    </p>
  );
}
