import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE_PATTERN, { message: "Use YYYY-MM-DD." });

// Validates a date-range selection from the dashboard (a query string
// today — see app/(app)/analytics/page.tsx — but shaped for a future
// server action or report-export endpoint just as well). start/end are
// only required when preset is 'custom'; enforced with refine rather than
// making them always-required, since every other preset derives its own
// range (see lib/analytics/aggregations.ts's resolveDateRange).
export const dateRangeQuerySchema = z
  .object({
    preset: z.enum(["today", "7d", "30d", "90d", "custom"]),
    start: isoDate.optional(),
    end: isoDate.optional(),
  })
  .refine((value) => value.preset !== "custom" || (value.start && value.end), {
    message: "A custom range requires both a start and end date.",
    path: ["start"],
  })
  .refine((value) => value.preset !== "custom" || !value.start || !value.end || value.start <= value.end, {
    message: "The start date must not be after the end date.",
    path: ["end"],
  });
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;
