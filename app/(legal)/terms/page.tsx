import type { Metadata } from "next";
import Link from "next/link";

import { BusinessDetail, LegalDocument, SupportEmail, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Terms of Service | Polimatiq",
  description: "The terms that govern your use of Polimatiq, the cold email outreach platform.",
  alternates: { canonical: "/terms" },
};

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "About these terms",
    content: (
      <>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and{" "}
          <BusinessDetail field="operatorName" /> (&ldquo;Polimatiq&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;),
          the operator of the Polimatiq website and application (the &ldquo;Service&rdquo;). By creating an
          account or using the Service, you agree to these Terms.
        </p>
        <p>
          If you use the Service on behalf of a company or other organization, you confirm that you have
          authority to accept these Terms for it, and &ldquo;you&rdquo; includes that organization.
        </p>
        <p>
          These Terms incorporate our <Link href="/privacy">Privacy Policy</Link>,{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link> and{" "}
          <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>.
        </p>
      </>
    ),
  },
  {
    id: "service",
    title: "The Service",
    content: (
      <>
        <p>Polimatiq is a business tool for running outbound email outreach. Depending on your plan, it lets you:</p>
        <ul>
          <li>connect sending mailboxes (Google and Microsoft accounts through their own sign-in, or any mailbox through SMTP/IMAP);</li>
          <li>import and manage leads and contact data;</li>
          <li>build multi-step email campaigns and sequences and send them on a schedule;</li>
          <li>detect and manage replies, unsubscribes and bounces;</li>
          <li>warm up mailboxes by exchanging messages with other participating mailboxes;</li>
          <li>verify email addresses and generate AI-assisted content using third-party providers you connect with your own API keys;</li>
          <li>view sending, engagement and deliverability analytics; and</li>
          <li>send activity summaries to integrations such as webhooks you configure.</li>
        </ul>
        <p>
          We may change, add or remove features over time. If we remove a material feature of a paid plan, we
          will give reasonable notice where practical.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts",
    content: (
      <>
        <p>
          The Service is intended for business use by people aged 18 or over. You must give accurate account
          information and keep it up to date.
        </p>
        <p>
          You are responsible for keeping your login credentials secure and for all activity under your account
          and workspace, including activity by people you give access to. Tell us promptly at{" "}
          <SupportEmail subject="Account security" /> if you believe your account has been accessed without
          authorization.
        </p>
      </>
    ),
  },
  {
    id: "responsible-sending",
    title: "Responsible sending and compliance with law",
    content: (
      <>
        <p>
          You decide who you email, what you send and when. You are solely responsible for making sure that your
          use of the Service, and every message sent through it, complies with all laws that apply to you and to
          your recipients. Depending on where you and your recipients are, these may include anti-spam, direct
          marketing, electronic communications, consumer protection and data protection laws.
        </p>
        <p>In particular, you are responsible for:</p>
        <ul>
          <li>having a lawful basis, and any consent the law requires, to contact each recipient;</li>
          <li>identifying yourself accurately as the sender and using truthful subject lines and content;</li>
          <li>honouring every opt-out and unsubscribe request promptly; and</li>
          <li>following the <Link href="/acceptable-use">Acceptable Use Policy</Link>.</li>
        </ul>
        <p>
          The Service includes tools that help, such as unsubscribe links and automatic suppression of
          unsubscribed and bounced addresses, but these tools do not make your sending lawful on their own.
          Polimatiq does not give legal advice; take your own advice if you are unsure what the law requires.
        </p>
      </>
    ),
  },
  {
    id: "your-data",
    title: "Your content and contact data",
    content: (
      <>
        <p>
          &ldquo;Your Content&rdquo; means everything you or your users upload to or create in the Service,
          including leads and contact lists, email templates, campaign content and settings. You keep all rights
          in Your Content.
        </p>
        <p>
          You confirm that you have all rights, permissions and lawful bases needed to upload Your Content and to
          have it processed through the Service, including personal data about your leads and recipients. You are
          responsible for the accuracy, quality and legality of Your Content and for how you obtained it.
        </p>
        <p>
          You give us permission to host, store, process, transmit and display Your Content only as needed to
          provide, secure and support the Service for you. How we handle personal data is described in our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services and integrations",
    content: (
      <>
        <p>
          The Service works with services operated by others, such as Google and Microsoft mailboxes, SMTP/IMAP
          servers, email verification providers, AI model providers, webhook destinations and our payment
          processor. When you connect one:
        </p>
        <ul>
          <li>your use of it is governed by that provider&rsquo;s own terms and policies, which you must follow;</li>
          <li>you authorize us to exchange data with it as needed to provide the features you use;</li>
          <li>
            where you connect a provider with your own API key (for example for email verification or AI), any
            charges that provider makes are between you and that provider; and
          </li>
          <li>we are not responsible for that provider&rsquo;s availability, accuracy, security or actions.</li>
        </ul>
        <p>
          Email verification results and AI-generated content are produced by third-party systems and may be
          inaccurate. Review AI-generated content before you send it; you are responsible for anything sent from
          your mailboxes.
        </p>
      </>
    ),
  },
  {
    id: "warmup",
    title: "Mailbox warmup",
    content: (
      <p>
        If you enable warmup for a mailbox, it sends messages to, receives messages from and replies to other
        mailboxes in the Polimatiq warmup network, which can include mailboxes belonging to other customers.
        Warmup messages are generated by the Service and are not marketing. Do not use warmup to send your own
        content to other participants, and do not read, copy or act on warmup messages you receive beyond normal
        mailbox handling.
      </p>
    ),
  },
  {
    id: "billing",
    title: "Plans, billing and renewal",
    content: (
      <>
        <p>
          Paid plans are subscriptions billed in advance for the duration you choose (for example 1, 3, 6 or 12
          months). Each plan has usage limits, such as numbers of mailboxes, leads and campaigns and a monthly
          sending volume, shown on the Billing page.
        </p>
        <p>
          <strong>Subscriptions renew automatically</strong> at the end of each billing period, at the then-current
          price for your plan and duration, until you cancel. We will give notice before changing the price of an
          existing subscription.
        </p>
        <p>
          Prices are shown in US dollars. Customers in India are charged in Indian rupees through our payment
          processor, Razorpay; the exact rupee amount is shown before you pay. Checkout may not be available in
          every country. Prices may be subject to applicable taxes. Under Reserve Bank of India rules, your bank
          may ask you to approve some recurring payments, for example renewals above ₹15,000; a renewal may not go
          through until you do.
        </p>
        <p>
          If a payment fails, we may suspend paid features until it succeeds. Cancellations and refunds are
          covered by our <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    content: (
      <p>
        You must follow the <Link href="/acceptable-use">Acceptable Use Policy</Link>, which prohibits spam, abuse
        and other harmful activity. You must also not interfere with or disrupt the Service, attempt to gain
        unauthorized access to it or to other customers&rsquo; data, reverse engineer it except as the law
        allows, or resell it without our written permission.
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and termination",
    content: (
      <>
        <p>
          You may stop using the Service and cancel your subscription at any time, as described in the{" "}
          <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>.
        </p>
        <p>
          We may suspend or terminate your account, pause your campaigns or disconnect mailboxes, with or without
          notice, if we reasonably believe that you have breached these Terms or the Acceptable Use Policy, that
          your use creates legal, security or deliverability risk for us, our providers, other customers or
          recipients, or if we are required to by law. Where it is reasonable to do so, we will tell you why and
          give you a chance to fix the problem first. Serious or repeated abuse may lead to immediate termination
          without a refund.
        </p>
        <p>
          After termination your right to use the Service ends. If you want a copy of Your Content, contact us
          before or promptly after your account closes and we will tell you what we can provide. We may then
          delete Your Content as described in the Privacy Policy.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "Service availability and changes",
    content: (
      <p>
        We work to keep the Service available and reliable, but it is provided on an &ldquo;as available&rdquo;
        basis. It may be interrupted for maintenance, updates, failures of third-party services or events outside
        our control. We do not guarantee that the Service will be uninterrupted or error-free, that any particular
        message will be delivered or reach an inbox, or any particular open, reply or other result.
      </p>
    ),
  },
  {
    id: "ip",
    title: "Our intellectual property",
    content: (
      <p>
        The Service, including its software, design and branding, belongs to us or our licensors. We grant you a
        limited, non-exclusive, non-transferable right to use the Service for your internal business purposes
        while your account is active and in line with these Terms. If you send us feedback or suggestions, we may
        use them without obligation to you.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    content: (
      <p>
        To the extent the law allows, the Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;,
        without warranties of any kind, whether express or implied, including warranties of merchantability,
        fitness for a particular purpose and non-infringement. Nothing in these Terms excludes any right or
        warranty that cannot lawfully be excluded.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    content: (
      <>
        <p>To the extent the law allows:</p>
        <ul>
          <li>
            we are not liable for indirect, incidental, special, consequential or punitive losses, or for loss of
            profits, revenue, business, goodwill or data, however caused; and
          </li>
          <li>
            To the maximum extent permitted by applicable law, Polimatiq&apos;s total aggregate liability arising out
            of or relating to the Service will not exceed the fees actually paid by you to Polimatiq for the Service
            during the one (1) month immediately preceding the event giving rise to the claim.
          </li>
        </ul>
        <p>These limits do not apply to liability that cannot be limited by law.</p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "Your responsibility for claims",
    content: (
      <p>
        You will defend and indemnify us against claims, fines and costs (including reasonable legal fees) brought
        by third parties or authorities that arise from Your Content, the messages you send through the Service,
        your breach of these Terms or the Acceptable Use Policy, or your breach of law.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    content: (
      <p>
        We may update these Terms from time to time. We will change the &ldquo;Last updated&rdquo; date above and,
        for material changes, give reasonable notice by email or in the Service before they take effect. If you
        keep using the Service after changes take effect, you accept the updated Terms. If you don&rsquo;t agree,
        stop using the Service and cancel your subscription.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    content: (
      <p>
        These Terms are governed by <BusinessDetail field="governingLaw" />. Before starting any formal
        proceedings, please contact us at <SupportEmail /> so we can try to resolve the issue informally.
      </p>
    ),
  },
  {
    id: "general",
    title: "General",
    content: (
      <p>
        If any part of these Terms is found unenforceable, the rest stays in effect. Our not enforcing a right is
        not a waiver of it. You may not transfer your rights under these Terms without our consent; we may
        transfer ours as part of a reorganization or sale of our business. These Terms, together with the policies
        they incorporate, are the whole agreement between you and us about the Service.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    content: (
      <p>
        Questions about these Terms: <SupportEmail subject="Terms of Service" />. Legal notices and formal
        inquiries can be sent to <SupportEmail subject="Legal notice" />.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      href="/terms"
      title="Terms of Service"
      summary={
        <p>
          These terms explain the rules for using Polimatiq, including your responsibility for the emails you send
          and the contact data you upload, how billing works, and when we may suspend an account.
        </p>
      }
      sections={sections}
    />
  );
}
