import { z } from "zod";

// Shared by the server schema and the live checklist in
// components/auth/password-strength.tsx. The symbol set matches Supabase
// Auth's `lower_upper_letters_digits_symbols` requirement exactly, so a
// password the form accepts is never rejected by Supabase.
export const PASSWORD_RULES = [
  { id: "length", label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { id: "lowercase", label: "A lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { id: "uppercase", label: "An uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { id: "number", label: "A number", test: (value: string) => /[0-9]/.test(value) },
  {
    id: "symbol",
    label: "A special character (e.g. ! @ # $)",
    test: (value: string) => /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/.test(value),
  },
] as const;

const passwordSchema = z.string().superRefine((value, ctx) => {
  const missing = PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.label.toLowerCase());
  if (missing.length > 0) {
    ctx.addIssue({ code: "custom", message: `Password needs: ${missing.join(", ")}.` });
  }
});

export const signInSchema = z.object({
  email: z.string().trim().min(1, { message: "Email is required." }).email({ message: "Enter a valid email address." }),
  password: z.string().min(1, { message: "Password is required." }),
});
export type SignInInput = z.infer<typeof signInSchema>;

// Letters in any script, with single spaces, hyphens or apostrophes between
// them ("Mary-Jane O'Neil", "José Álvarez") — no digits or symbols.
export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { message: "Enter your full name." })
  .max(120, { message: "Keep your name under 120 characters." })
  .regex(/^[\p{L}\p{M}]+(?:[ '’-][\p{L}\p{M}]+)*$/u, {
    message: "Use letters only — spaces, hyphens and apostrophes are fine.",
  });

export const signUpSchema = z
  .object({
    fullName: fullNameSchema,
    email: z.string().trim().min(1, { message: "Email is required." }).email({ message: "Enter a valid email address." }),
    password: passwordSchema,
    confirmPassword: z.string(),
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
    signOutOthers: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
