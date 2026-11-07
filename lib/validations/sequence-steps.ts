import { z } from "zod";
import { STEP_CONDITIONS } from "@/lib/email/step-conditions";

export const sequenceStepSchema = z.object({
  dayDelay: z.number().int().min(0, { message: "Must be 0 or greater." }).max(365),
  subject: z.string().trim().max(500).optional().or(z.literal("")),
  body: z.string().trim().max(20000).optional().or(z.literal("")),
  // Send this step only if the lead opened / didn't open / clicked / didn't
  // click an earlier step (conditionStepId; "" = any earlier email). That
  // the step is really earlier in the same sequence is checked server-side.
  condition: z.enum(STEP_CONDITIONS).optional(),
  conditionStepId: z.string().uuid().optional().or(z.literal("")),
});
export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;
