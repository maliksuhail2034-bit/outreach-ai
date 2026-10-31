import { z } from "zod";
import { fullNameSchema } from "./auth";

export const profileSchema = z.object({
  fullName: fullNameSchema,
  avatarUrl: z
    .string()
    .trim()
    .url({ message: "Enter a valid URL." })
    .max(2048)
    .optional()
    .or(z.literal("")),
  timezone: z.string().trim().min(1, { message: "Select a timezone." }),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const settingsSchema = z.object({
  signature: z.string().trim().max(2000).optional().or(z.literal("")),
  unsubscribeText: z.string().trim().max(500).optional().or(z.literal("")),
  trackingEnabled: z.boolean(),
  timezone: z.string().trim().min(1, { message: "Select a timezone." }),
});
export type SettingsInput = z.infer<typeof settingsSchema>;
