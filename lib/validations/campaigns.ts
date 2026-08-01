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

// Validates the ?a=&b= query string on /campaigns/compare. Both are
// optional (an empty/partial query just shows the campaign picker instead
// of a comparison — see the page component); getCampaign()'s existing
// userId-scoped ownership check is what actually guards access to the two
// ids once they're valid.
export const campaignCompareQuerySchema = z.object({
  a: z.string().uuid().optional(),
  b: z.string().uuid().optional(),
});
export type CampaignCompareQuery = z.infer<typeof campaignCompareQuerySchema>;
