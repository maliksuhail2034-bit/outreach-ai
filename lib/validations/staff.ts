import { z } from "zod";

import { normalizeUsername, usernameProblem } from "@/lib/staff/password-policy";

export const staffRoleSchema = z.enum(["owner", "security", "sales"]);

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .superRefine((value, ctx) => {
    const problem = usernameProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "Enter a valid email address." }).max(254),
  displayName: z.string().trim().min(1, { message: "Enter the person's name." }).max(120),
  username: usernameSchema,
  role: staffRoleSchema,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const staffIdSchema = z.string().uuid();

export const changeStaffRoleSchema = z.object({ staffId: staffIdSchema, role: staffRoleSchema });

// --- Security panel ---------------------------------------------------------------

export const userIdSchema = z.string().uuid();
export const recordIdSchema = z.string().uuid();

export const ipBlockSchema = z.object({
  cidr: z.string().trim().min(2).max(64),
  reason: z.string().trim().min(1, { message: "Say why this address is blocked." }).max(500),
  // Empty = permanent.
  expiresInHours: z.number().int().min(1).max(24 * 365).optional(),
});
export type IpBlockInput = z.infer<typeof ipBlockSchema>;

export const grcControlUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["not_started", "in_progress", "done", "not_applicable"]),
  notes: z.string().max(2000),
});
export type GrcControlUpdateInput = z.infer<typeof grcControlUpdateSchema>;

// --- Owner panel ------------------------------------------------------------------

export const planLeadQuotaSchema = z.object({
  planId: z.enum(["free", "starter", "growth", "pro", "scale"]),
  leadsPerMonth: z
    .number({ message: "Enter a whole number of leads." })
    .int({ message: "Enter a whole number of leads." })
    .min(0, { message: "The quota can't be negative." })
    .max(100_000, { message: "The quota can be at most 100,000 a month." }),
});
export type PlanLeadQuotaInput = z.infer<typeof planLeadQuotaSchema>;

// --- Employees ----------------------------------------------------------------------

// Password strength is checked against the target's role in
// lib/staff/password-policy.ts; this only bounds the input.
export const passwordInputSchema = z.string().min(1, { message: "Enter a password." }).max(200);

export const setStaffPasswordSchema = z.object({
  staffId: staffIdSchema,
  password: passwordInputSchema,
  mustChange: z.boolean(),
});
export type SetStaffPasswordInput = z.infer<typeof setStaffPasswordSchema>;

export const changeUsernameSchema = z.object({ staffId: staffIdSchema, username: usernameSchema });

export const ownPasswordSchema = z
  .object({ password: passwordInputSchema, confirmPassword: z.string() })
  .refine((value) => value.password === value.confirmPassword, { message: "The passwords don't match.", path: ["confirmPassword"] });

export const staffSignInSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, { message: "Enter your username." }).max(64),
  password: z.string().min(1, { message: "Enter your password." }).max(200),
});
