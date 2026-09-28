import { z } from "zod";
import { isValidIanaTimezone } from "@/lib/timezones";

export const SENDING_WINDOW_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// campaigns.sending_window is unstructured jsonb (default '{}') — this gives
// it a validated shape. Whole hours only. endHour < startHour is an
// overnight window (see isOvernightWindow); endHour === startHour is
// rejected as ambiguous — all day is 0 -> 24.
export const sendingWindowSchema = z
  .object({
    days: z.array(z.enum(SENDING_WINDOW_DAYS)).min(1),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    // Any real IANA identifier, not a fixed enum of a handful of zones — a
    // Server Function is reachable directly via POST regardless of what a
    // client-side picker already offered, so this is the actual boundary
    // that rejects "not really a timezone" strings (see
    // lib/timezones.ts's isValidIanaTimezone, which is what both this and
    // the campaign scheduling UI's picker use).
    timezone: z.string().min(1).refine(isValidIanaTimezone, { message: "Enter a valid IANA timezone (e.g. Asia/Riyadh)." }),
  })
  .refine((window) => window.endHour !== window.startHour, { message: "Start and end hour can't be the same." });

export type SendingWindowDay = (typeof SENDING_WINDOW_DAYS)[number];
export type SendingWindow = z.infer<typeof sendingWindowSchema>;

// An overnight window (e.g. 22 -> 6) runs from startHour on an allowed day
// to endHour on the following day: it belongs to the day it starts, so with
// Mon-Fri 22 -> 6, Sat 03:00 is inside (Friday's window) and Mon 03:00 isn't.
export function isOvernightWindow(window: Pick<SendingWindow, "startHour" | "endHour">) {
  return window.endHour < window.startHour;
}
