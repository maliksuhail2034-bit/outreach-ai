import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument, SupportEmail, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Acceptable Use Policy | Polimatiq",
  description: "The rules for responsible outbound email and acceptable use of Polimatiq.",
  alternates: { canonical: "/acceptable-use" },
};

const sections: LegalSection[] = [
  {
    id: "purpose",
    title: "Purpose",
    content: (
      <>
        <p>
          Polimatiq is built for relevant, one-to-one style business outreach. This policy sets out what you may
          and may not do with the Service, so that recipients are treated fairly and every customer&rsquo;s
          mailboxes keep a good sending reputation. It forms part of our <Link href="/terms">Terms of Service</Link>{" "}
          and applies to everyone who uses your account.
        </p>
        <p>
          Following this policy does not by itself make your sending lawful. You are responsible for complying with
          the laws that apply to you and to your recipients.
        </p>
      </>
    ),
  },
  {
    id: "outbound",
    title: "Responsible outbound email",
    content: (
      <>
        <p>When you send through Polimatiq, you must:</p>
        <ul>
          <li>
            only contact people where you have a lawful basis, and any consent the law requires, to do so, for
            example a genuine and relevant business reason to contact them in their professional role;
          </li>
          <li>send from mailboxes and domains you own or are authorized to use, and identify yourself accurately;</li>
          <li>use subject lines and content that are truthful and not misleading;</li>
          <li>
            give every recipient a clear way to opt out, honour opt-outs promptly, and never re-add an address that
            has unsubscribed or asked you to stop. Do not remove or disable the Service&rsquo;s unsubscribe
            handling;
          </li>
          <li>include any sender information the law requires, such as a postal address where applicable;</li>
          <li>keep your lists clean: remove bounced, invalid and role-based addresses that did not ask to hear from you; and</li>
          <li>keep complaint and bounce rates low and stay within the sending limits of your plan and of your mailbox providers.</li>
        </ul>
      </>
    ),
  },
  {
    id: "data",
    title: "Contact data you upload",
    content: (
      <>
        <p>You are responsible for every lead and contact you upload. You must not upload or use:</p>
        <ul>
          <li>purchased, rented, scraped or harvested lists of people who have no relationship with you, where the law does not allow you to contact them;</li>
          <li>addresses obtained by guessing, dictionary attacks or other automated generation;</li>
          <li>personal data you are not allowed to process, or special categories of sensitive data (such as health, financial account, or government ID data) without a lawful basis; or</li>
          <li>data about children.</li>
        </ul>
      </>
    ),
  },
  {
    id: "prohibited-content",
    title: "Prohibited content",
    content: (
      <>
        <p>You must not use the Service to send or store content that:</p>
        <ul>
          <li>is spam, unsolicited bulk email, or chain letters;</li>
          <li>is phishing, impersonates another person or organization, or tries to obtain passwords or financial details by deception;</li>
          <li>contains or links to malware, or to sites that distribute it;</li>
          <li>promotes scams, fraud, pyramid schemes or deceptive &ldquo;get rich quick&rdquo; offers;</li>
          <li>offers illegal goods or services, or regulated goods and services without the required authorization;</li>
          <li>is defamatory, harassing, threatening, hateful or sexually explicit; or</li>
          <li>infringes anyone&rsquo;s intellectual property or privacy rights.</li>
        </ul>
      </>
    ),
  },
  {
    id: "prohibited-activity",
    title: "Prohibited activity",
    content: (
      <>
        <p>You must not:</p>
        <ul>
          <li>disguise the origin of messages, forge headers, or use deceptive sender names or reply-to addresses;</li>
          <li>use techniques designed to evade spam filters, blocklists or your mailbox provider&rsquo;s limits, or rotate mailboxes or domains to evade a block or complaint;</li>
          <li>connect mailboxes you are not authorized to use, or share accounts in breach of a provider&rsquo;s terms;</li>
          <li>send your own content to other participants through the warmup network, or interfere with warmup traffic;</li>
          <li>use AI features to generate content that breaks this policy, or send AI-generated content without reviewing it;</li>
          <li>probe, scan or test the vulnerability of the Service, bypass usage limits or access controls, or access other customers&rsquo; data; or</li>
          <li>place an excessive load on the Service or use it in a way that harms other customers.</li>
        </ul>
      </>
    ),
  },
  {
    id: "third-party-rules",
    title: "Mailbox and provider rules",
    content: (
      <p>
        You must also follow the rules of the services you connect, including Google&rsquo;s and Microsoft&rsquo;s
        policies for mailboxes and the terms of your email verification and AI providers. A provider may suspend
        your mailbox or account independently of us.
      </p>
    ),
  },
  {
    id: "enforcement",
    title: "Monitoring and enforcement",
    content: (
      <>
        <p>
          We may review accounts, campaigns and sending metrics, such as bounce, complaint and unsubscribe rates,
          and investigate reports we receive, to enforce this policy. If we reasonably believe you have broken it,
          we may, with or without notice:
        </p>
        <ul>
          <li>pause campaigns or sending, or disconnect mailboxes;</li>
          <li>remove or disable content;</li>
          <li>limit features, sending volume or warmup participation;</li>
          <li>suspend or terminate your account, without a refund in cases of abuse; and</li>
          <li>report illegal activity to the appropriate authorities.</li>
        </ul>
        <p>
          Where it is reasonable to do so, we will contact you first and give you a chance to fix the problem.
        </p>
      </>
    ),
  },
  {
    id: "report",
    title: "Reporting abuse",
    content: (
      <>
        <p>
          If you received an unwanted email sent through Polimatiq, first use the unsubscribe link in the email or
          ask the sender to stop. To report spam, phishing or other abuse by a Polimatiq customer, email{" "}
          <SupportEmail subject="Abuse report" /> and include the full email with its headers if possible.
        </p>
        <p>
          See also our <Link href="/privacy#recipients">Privacy Policy</Link> for recipients.
        </p>
      </>
    ),
  },
];

export default function AcceptableUsePage() {
  return (
    <LegalDocument
      href="/acceptable-use"
      title="Acceptable Use Policy"
      summary={
        <p>
          The rules for responsible outbound email on Polimatiq: who you may contact, what you may send, what is
          prohibited, and what happens when the rules are broken.
        </p>
      }
      sections={sections}
    />
  );
}
