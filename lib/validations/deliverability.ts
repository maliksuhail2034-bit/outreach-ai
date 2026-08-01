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
