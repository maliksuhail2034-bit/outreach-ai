import { z } from "zod";
import { sendingWindowSchema } from "./sending-window";

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const;

export const campaignSchema = z.object({
  name: z.string().trim().min(1, { message: "Enter a campaign name." }).max(200),
  // Optional so a create submission can omit it and let the DB default
  // ('draft') apply — see supabase/migrations/20260728100060_campaigns.sql.
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  dailyLimit: z.number().int().min(1, { message: "Must be at least 1." }).max(10000),
  defaultMailboxId: z.string().trim().optional().or(z.literal("")),
  sendingWindow: sendingWindowSchema,
});
export type CampaignInput = z.infer<typeof campaignSchema>;
