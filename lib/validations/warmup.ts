import { z } from "zod";

export const warmupSettingsSchema = z.object({
  targetDailyVolume: z.number().int().min(1, { message: "Must be at least 1." }).max(1000),
  rampUpPercent: z.number().min(1, { message: "Must be at least 1%." }).max(200),
});
export type WarmupSettingsInput = z.infer<typeof warmupSettingsSchema>;
