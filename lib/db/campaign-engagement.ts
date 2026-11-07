import { z } from "zod";
import type { Client } from "./shared";

// One campaign's engagement from campaign_engagement()
// (supabase/migrations/20261113100000_crm_sequences.sql): unique people,
// bots excluded, over every row. Parsed rather than cast, so a shape change
// in the SQL fails loudly instead of rendering wrong numbers.

const count = z.number().int().nonnegative();

const stepEngagementSchema = z.object({
  step_id: z.string(),
  step_order: z.number(),
  subject: z.string().nullable(),
  condition: z.string(),
  sent: count,
  unique_opened: count,
  unique_clicked: count,
  unique_replied: count,
});

const campaignEngagementSchema = z.object({
  emails_sent: count,
  leads_contacted: count,
  unique_opened: count,
  unique_clicked: count,
  unique_replied: count,
  unique_bounced: count,
  unique_unsubscribed: count,
  bot_opens: count,
  bot_clicks: count,
  steps: z.array(stepEngagementSchema),
});

export type CampaignEngagement = z.infer<typeof campaignEngagementSchema>;
export type StepEngagementRow = z.infer<typeof stepEngagementSchema>;

export async function getCampaignEngagement(supabase: Client, campaignId: string): Promise<CampaignEngagement> {
  const { data, error } = await supabase.rpc("campaign_engagement", { p_campaign_id: campaignId });
  if (error) throw error;
  return campaignEngagementSchema.parse(data);
}
