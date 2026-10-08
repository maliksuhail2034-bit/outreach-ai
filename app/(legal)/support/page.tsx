import type { Metadata } from "next";
import Link from "next/link";

import { BusinessDetail, LegalDocument, SupportEmail, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Support & Contact | Polimatiq",
  description: "How to get help with Polimatiq, ask about billing, make a privacy request or report abuse.",
  alternates: { canonical: "/support" },
};

const sections: LegalSection[] = [
  {
    id: "contact",
    title: "Contact us",
    content: (
      <>
        <p>
          Email <SupportEmail /> for help with your account, mailboxes, campaigns or billing. Please write from the
          email address on your Polimatiq account so we can find your workspace, and include:
        </p>
        <ul>
          <li>what you were trying to do and what happened instead;</li>
          <li>the page, campaign or mailbox involved; and</li>
          <li>any error message you saw (a screenshot helps).</li>
        </ul>
        <p>
          Never send your password, API keys or full card details by email. We will never ask for them.
        </p>
      </>
    ),
  },
  {
    id: "topics",
    title: "Common requests",
    content: (
      <ul>
        <li>
          <strong>Billing and cancellation:</strong> cancel any time from the Billing page in the app. For billing
          questions or refund requests, email <SupportEmail subject="Billing" />. See the{" "}
          <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>.
        </li>
        <li>
          <strong>Privacy requests:</strong> to access, correct or delete personal data, email{" "}
          <SupportEmail subject="Privacy request" />. See the <Link href="/privacy">Privacy Policy</Link>.
        </li>
        <li>
          <strong>Security issues:</strong> if you think your account was accessed without permission, or you
          found a security problem, email <SupportEmail subject="Security" />.
        </li>
        <li>
          <strong>Reporting abuse:</strong> if you received spam or another unwanted email sent through Polimatiq,
          use its unsubscribe link, then email <SupportEmail subject="Abuse report" /> with the full email and
          headers. See the <Link href="/acceptable-use">Acceptable Use Policy</Link>.
        </li>
      </ul>
    ),
  },
  {
    id: "response",
    title: "Response times",
    content: (
      <p>
        We answer support requests by email, in the order they arrive, and prioritize account security, billing
        and abuse reports. We don&rsquo;t offer phone support or a guaranteed response time.
      </p>
    ),
  },
  {
    id: "business",
    title: "Business details",
    content: (
      <ul>
        <li>
          Operator: <BusinessDetail field="operatorName" />
        </li>
        <li>
          Email: <SupportEmail />
        </li>
        <li>
          Legal notices and formal inquiries: <SupportEmail subject="Legal notice" />
        </li>
      </ul>
    ),
  },
];

export default function SupportPage() {
  return (
    <LegalDocument
      href="/support"
      title="Support & Contact"
      summary={<p>Get help with Polimatiq, ask a billing question, make a privacy request or report abuse.</p>}
      sections={sections}
    />
  );
}
