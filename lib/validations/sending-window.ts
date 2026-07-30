import { z } from "zod";

export const SENDING_WINDOW_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// campaigns.sending_window is unstructured jsonb (default '{}') — this gives
// it a validated shape. No overnight windows in v1 (endHour must be after
// startHour) — a known limitation, not a bug.
export const sendingWindowSchema = z
  .object({
    days: z.array(z.enum(SENDING_WINDOW_DAYS)).min(1),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    timezone: z.string().min(1),
  })
  .refine((window) => window.endHour > window.startHour, { message: "End hour must be after start hour." });

export type SendingWindowDay = (typeof SENDING_WINDOW_DAYS)[number];
export type SendingWindow = z.infer<typeof sendingWindowSchema>;
