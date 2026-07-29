import { z } from "zod";

export const leadListSchema = z.object({
  name: z.string().trim().min(1, { message: "Enter a list name." }).max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});
export type LeadListInput = z.infer<typeof leadListSchema>;
