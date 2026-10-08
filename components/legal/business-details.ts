// Business details the legal pages refer to. Each null value is a detail
// that hasn't been confirmed yet. The pages render a null value as a
// clearly marked placeholder rather than guessing, so nothing here is
// invented. Fill these in, never in the page copy itself, before the pages
// are relied on.
export interface BusinessDetails {
  // Who operates Polimatiq and is party to the Terms: a registered company
  // name, or the individual/sole proprietor trading as Polimatiq.
  operatorName: string | null;
  // The one inbox for support, billing, privacy and abuse reports, and for
  // legal notices and formal inquiries (there is no published postal
  // address).
  supportEmail: string | null;
  // Governing law and the courts that hear disputes, e.g. "the laws of
  // India, with the courts at <city> having exclusive jurisdiction".
  governingLaw: string | null;
  // When these documents take effect, as shown under each page title.
  lastUpdated: string | null;
}

export const BUSINESS_DETAILS: BusinessDetails = {
  operatorName: "Polimatiq",
  supportEmail: "support@polimatiq.com",
  governingLaw: "the laws of India",
  lastUpdated: "9 October 2026",
};

export const PLACEHOLDER_LABELS: Record<keyof BusinessDetails, string> = {
  operatorName: "operator / legal entity name",
  supportEmail: "support email address",
  governingLaw: "governing law and jurisdiction",
  lastUpdated: "effective date",
};
