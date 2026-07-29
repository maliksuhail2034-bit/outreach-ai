import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, { message: "Must be at least 8 characters." })
  .regex(/[a-z]/, { message: "Include a lowercase letter." })
  .regex(/[A-Z]/, { message: "Include an uppercase letter." })
  .regex(/[0-9]/, { message: "Include a number." });

export const signInSchema = z.object({
  email: z.string().trim().min(1, { message: "Email is required." }).email({ message: "Enter a valid email address." }),
  password: z.string().min(1, { message: "Password is required." }),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, { message: "Enter your full name." }),
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
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
