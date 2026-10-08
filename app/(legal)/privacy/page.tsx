import type { Metadata } from "next";
import Link from "next/link";

import { BusinessDetail, LegalDocument, SupportEmail, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy | Polimatiq",
  description: "How Polimatiq collects, uses, shares and protects personal data.",
  alternates: { canonical: "/privacy" },
};

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Who we are and what this covers",
    content: (
      <>
        <p>
          Polimatiq is operated by <BusinessDetail field="operatorName" /> (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
          This policy explains how we handle personal data when you visit our website, create an account or use
          the Polimatiq application (the &ldquo;Service&rdquo;).
        </p>
        <p>There are two kinds of personal data to keep apart:</p>
        <ul>
          <li>
            <strong>Customer account data:</strong> data about you and your team as our customers. We decide how
            this is used, as described below.
          </li>
          <li>
            <strong>Customer content:</strong> the leads, contact lists, messages and replies you bring into or send
            through the Service. You decide what goes in and how it is used; we process it on your behalf to provide
            the Service. If you are a recipient of an email sent through Polimatiq, see{" "}
            <a href="#recipients">If you received an email sent through Polimatiq</a>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "collect",
    title: "Data we collect",
    content: (
      <>
        <p>
          <strong>Account information:</strong> your name, email address, password (stored by our authentication
          provider, never in plain text), workspace and profile settings.
        </p>
        <p>
          <strong>Connected mailboxes and integrations:</strong> the mailbox addresses you connect; OAuth tokens
          from Google or Microsoft, or SMTP/IMAP credentials; and API keys you add for third-party providers such
          as email verification and AI. Mailbox credentials and provider API keys are stored encrypted.
        </p>
        <p>
          <strong>Customer content:</strong> leads and their details (such as names, email addresses, companies,
          job titles and time zones), campaign and template content, sent messages, replies and other mailbox
          messages the Service reads to detect replies, bounces and warmup traffic, verification results, and
          AI-generated content.
        </p>
        <p>
          <strong>Sending and engagement data:</strong> send attempts, delivery errors and bounces, unsubscribes,
          and opens and clicks recorded by tracking links and pixels in campaign emails.
        </p>
        <p>
          <strong>Billing information:</strong> your plan, subscription status and payment history. Card, UPI and
          bank details are collected and processed by our payment processor, Razorpay; we do not receive or store
          your full payment details.
        </p>
        <p>
          <strong>Technical data:</strong> information your browser sends, such as IP address and approximate
          country (used, for example, to decide which payment currency applies to you), plus security, rate-limit
          and service logs.
        </p>
        <p>
          <strong>Communications:</strong> messages you send to support and related records.
        </p>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use data",
    content: (
      <>
        <p>We use customer account data to:</p>
        <ul>
          <li>create and run your account and provide the features you use;</li>
          <li>process payments, manage subscriptions and enforce plan limits;</li>
          <li>keep the Service secure, prevent fraud and abuse, and enforce our Terms and Acceptable Use Policy;</li>
          <li>monitor and improve reliability and deliverability;</li>
          <li>send service messages such as account confirmations, password resets, billing and policy notices; and</li>
          <li>respond to support requests and meet legal obligations.</li>
        </ul>
        <p>
          We use customer content only to provide, secure and support the Service for you, including detecting
          misuse of the Service. We do not sell personal data, and we do not use your leads or messages to market
          to them ourselves.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Service providers and sharing",
    content: (
      <>
        <p>We share personal data only as needed to run the Service, with:</p>
        <ul>
          <li><strong>Infrastructure providers:</strong> Supabase (database and authentication) and Vercel (application hosting);</li>
          <li><strong>Payment processing:</strong> Razorpay;</li>
          <li><strong>Email delivery for account messages</strong> such as confirmations and password resets;</li>
          <li>
            <strong>Providers you connect:</strong> Google or Microsoft for connected mailboxes, your SMTP/IMAP
            servers, your email verification provider (such as MillionVerifier), your AI provider (such as
            Anthropic, OpenAI or Google) and webhook destinations you configure. Data you send to these providers
            is also handled under their own terms and privacy policies;
          </li>
          <li>
            <strong>Other warmup participants:</strong> if you enable warmup, your mailbox exchanges
            Service-generated messages with other mailboxes in the warmup network, so those mailboxes see your
            mailbox address and the warmup messages;
          </li>
          <li><strong>Authorities and others where required by law</strong>, or to protect rights, safety and the Service; and</li>
          <li><strong>A successor</strong> in a merger, acquisition or sale of our business, subject to this policy.</li>
        </ul>
        <p>Our providers may process data in countries other than yours.</p>
      </>
    ),
  },
  {
    id: "ai",
    title: "AI features",
    content: (
      <p>
        AI-assisted features run only with an AI provider you connect using your own API key. When you use them,
        the content needed for the request (for example lead details and your prompt or template) is sent to that
        provider and handled under your account with them. We do not use your content to train AI models.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and similar technologies",
    content: (
      <p>
        We use cookies that are needed to keep you signed in and to secure your session, and your browser stores
        preferences such as light or dark theme. We do not use advertising cookies or third-party analytics
        trackers on our website or application. Campaign emails sent through the Service may contain open-tracking
        pixels and tracked links, as described above.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep data",
    content: (
      <>
        <p>
          We keep customer account data and customer content for as long as your account is active and as needed
          to provide the Service. Some operational logs are deleted automatically on a schedule, for example
          rate-limit records after 7 days and background job records after 90 days.
        </p>
        <p>
          Unsubscribe and bounce suppression records are kept so that suppressed addresses stay blocked, including
          after the related lead is deleted. When an account is closed we delete or anonymize its data within a
          reasonable period, except where we need to keep it for legal, accounting, security or dispute purposes.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    content: (
      <p>
        We use measures such as encryption in transit, encryption of stored mailbox credentials and provider API
        keys, access controls that separate each customer&rsquo;s data, and restricted administrative access. No
        system is completely secure, and we cannot guarantee absolute security. Keep your password secure and tell
        us at <SupportEmail subject="Security" /> if you suspect unauthorized access.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your choices and rights",
    content: (
      <>
        <p>
          You can view and update much of your account information in the Service. You can also ask us to access,
          correct, delete or provide a copy of your personal data, or object to or restrict certain uses, by
          emailing <SupportEmail subject="Privacy request" />. Depending on where you live, you may have additional
          rights under local law, including the right to complain to a data protection authority. We may need to
          verify your identity before acting on a request.
        </p>
        <p>
          Requests about customer content, such as a request from someone on a customer&rsquo;s lead list, are
          handled by that customer. Where we receive one, we will refer it to the customer or help them respond.
        </p>
      </>
    ),
  },
  {
    id: "recipients",
    title: "If you received an email sent through Polimatiq",
    content: (
      <>
        <p>
          Polimatiq customers send emails from their own mailboxes using our software. The customer who sent the
          email is responsible for it and for how they obtained your details.
        </p>
        <ul>
          <li>To stop receiving emails from that sender, use the unsubscribe link in the email or reply asking them to stop.</li>
          <li>To ask the sender about your data, contact them directly.</li>
          <li>
            To report spam or abuse by a Polimatiq customer, email <SupportEmail subject="Abuse report" /> and
            include the email, with its headers if possible. See our{" "}
            <Link href="/acceptable-use">Acceptable Use Policy</Link>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    content: <p>The Service is for business use and is not directed to children. We do not knowingly collect children&rsquo;s personal data.</p>,
  },
  {
    id: "changes",
    title: "Changes to this policy",
    content: (
      <p>
        We may update this policy. We will change the &ldquo;Last updated&rdquo; date above and, for material
        changes, give notice by email or in the Service.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    content: (
      <p>
        Privacy questions and requests: <SupportEmail subject="Privacy" />. Legal notices and formal inquiries
        can be sent to <SupportEmail subject="Legal notice" />.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      href="/privacy"
      title="Privacy Policy"
      summary={
        <p>
          This policy explains what personal data Polimatiq collects, how it is used and shared, how long it is
          kept, and the choices you have, including if you received an email sent by a Polimatiq customer.
        </p>
      }
      sections={sections}
    />
  );
}
