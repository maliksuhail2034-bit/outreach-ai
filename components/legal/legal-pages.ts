// Every public legal/support page, in the order they're listed in the
// footer and in each legal page's own navigation.
export const LEGAL_PAGES = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund-policy", label: "Refund & Cancellation Policy" },
  { href: "/acceptable-use", label: "Acceptable Use Policy" },
  { href: "/support", label: "Support & Contact" },
] as const;

export type LegalPageHref = (typeof LEGAL_PAGES)[number]["href"];
