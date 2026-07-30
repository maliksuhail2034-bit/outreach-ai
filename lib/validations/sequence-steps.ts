import { z } from "zod";

export const sequenceStepSchema = z.object({
  dayDelay: z.number().int().min(0, { message: "Must be 0 or greater." }).max(365),
  subject: z.string().trim().max(500).optional().or(z.literal("")),
  body: z.string().trim().max(20000).optional().or(z.literal("")),
});
export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;
