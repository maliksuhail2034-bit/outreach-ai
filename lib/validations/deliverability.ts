import { z } from "zod";

// Loose hostname validation — good enough to catch obvious typos without
// rejecting valid edge cases (punycode, multi-label subdomains) that a
// stricter regex would miss.
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export const domainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { message: "Enter a domain." })
    .max(255)
    .regex(DOMAIN_PATTERN, { message: "Enter a valid domain, e.g. yourdomain.com." }),
});
export type DomainInput = z.infer<typeof domainSchema>;

// Validates the ?a=&b= query string on /settings/deliverability/compare.
// Both are optional (an empty/partial query just shows the domain picker
// instead of a comparison — see the page component); getDomain()'s existing
// userId-scoped ownership check is what actually guards access to the two
// ids once they're valid. Same shape as campaignCompareQuerySchema /
// mailboxCompareQuerySchema.
export const domainCompareQuerySchema = z.object({
  a: z.string().uuid().optional(),
  b: z.string().uuid().optional(),
});
export type DomainCompareQuery = z.infer<typeof domainCompareQuerySchema>;
