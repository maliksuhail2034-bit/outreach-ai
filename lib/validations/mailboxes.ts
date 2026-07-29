import { z } from "zod";

export const mailboxSchema = z.object({
  email: z.string().trim().min(1, { message: "Enter an email address." }).email({ message: "Enter a valid email address." }).max(320),
  displayName: z.string().trim().max(120).optional().or(z.literal("")),
  smtpHost: z.string().trim().min(1, { message: "Enter an SMTP host." }).max(255),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUsername: z.string().trim().min(1, { message: "Enter an SMTP username." }).max(255),
  // Required on create, optional on update (blank = keep the existing
  // credential) — enforced in the Server Function, not here, since zod has
  // no notion of which action is calling it.
  smtpPassword: z.string().max(500).optional().or(z.literal("")),
  dailyLimit: z.number().int().min(1, { message: "Must be at least 1." }).max(10000),
  warmupEnabled: z.boolean(),
  domainId: z.string().trim().optional().or(z.literal("")),
  status: z.enum(["active", "paused", "error"]).optional(),
});
export type MailboxInput = z.infer<typeof mailboxSchema>;
