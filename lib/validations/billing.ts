import { z } from "zod";
import { PAID_PLAN_IDS } from "@/lib/billing/plans";

export const checkoutSchema = z.object({
  planId: z.enum(PAID_PLAN_IDS),
  interval: z.enum(["1_month", "3_month", "6_month", "12_month"]),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
