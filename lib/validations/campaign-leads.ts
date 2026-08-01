import { z } from "zod";

export const CAMPAIGN_LEAD_STATUSES = [
  "pending",
  "active",
  "replied",
  "bounced",
  "unsubscribed",
  "completed",
  "cancelled",
] as const;

// Used when editing an existing enrollment — overriding its mailbox or
// manually updating its status. Enrollment itself (which lead/list, initial
// mailbox) is driven by IDs from a Select, not free-typed input, so it
// doesn't need its own schema beyond this.
export const campaignLeadSchema = z.object({
  mailboxId: z.string().trim().optional().or(z.literal("")),
  status: z.enum(CAMPAIGN_LEAD_STATUSES),
});
export type CampaignLeadInput = z.infer<typeof campaignLeadSchema>;
