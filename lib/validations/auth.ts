import { z } from "zod";

// Single source of truth for the password policy: the zod schema below (the
// server-side check every auth Server Function runs) and the live checklist
// on the sign-up/reset forms (components/auth/password-requirements.tsx)
// both read this list, so the rules a user is shown can never drift from the
// rules the server enforces.
export const PASSWORD_MAX_LENGTH = 72; // bcrypt (Supabase Auth) ignores bytes past 72

export const PASSWORD_RULES = [
  { id: "length", label: "At least 8 characters", message: "Must be at least 8 characters.", test: (value: string) => value.length >= 8 },
  { id: "lowercase", label: "One lowercase letter (a–z)", message: "Include a lowercase letter.", test: (value: string) => /[a-z]/.test(value) },
  { id: "uppercase", label: "One uppercase letter (A–Z)", message: "Include an uppercase letter.", test: (value: string) => /[A-Z]/.test(value) },
  { id: "number", label: "One number (0–9)", message: "Include a number.", test: (value: string) => /[0-9]/.test(value) },
] as const;

export function unmetPasswordRules(value: string) {
  return PASSWORD_RULES.filter((rule) => !rule.test(value));
}

const passwordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, { message: `Must be at most ${PASSWORD_MAX_LENGTH} characters.` })
  .superRefine((value, ctx) => {
    for (const rule of unmetPasswordRules(value)) {
      ctx.addIssue({ code: "custom", message: rule.message });
    }
  });

export const signInSchema = z.object({
  email: z.string().trim().min(1, { message: "Email is required." }).email({ message: "Enter a valid email address." }),
  password: z.string().min(1, { message: "Password is required." }),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, { message: "Enter your full name." }).max(120, { message: "Keep your name under 120 characters." }),
    email: z.string().trim().min(1, { message: "Email is required." }).email({ message: "Enter a valid email address." }),
    password: passwordSchema,
    confirmPassword: z.string(),
    // The browser's IANA zone, sent by the sign-up form so the new profile
    // starts in the user's own timezone instead of UTC. Optional and
    // validated against the curated list where it's used (lib/actions/auth.ts).
    timezone: z.string().trim().max(64).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type SignUpInput = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, { message: "Email is required." }).email({ message: "Enter a valid email address." }),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
