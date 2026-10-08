import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument, SupportEmail, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy | Polimatiq",
  description: "How cancelling a Polimatiq subscription works and when payments can be refunded.",
  alternates: { canonical: "/refund-policy" },
};

const sections: LegalSection[] = [
  {
    id: "subscriptions",
    title: "How subscriptions work",
    content: (
      <>
        <p>
          Polimatiq paid plans are subscriptions paid in advance for the billing duration you choose (1, 3, 6 or 12
          months). They renew automatically at the end of each period until cancelled.
        </p>
        <p>
          Prices are shown in US dollars. Customers in India pay in Indian rupees through Razorpay, and the exact
          rupee amount is shown before payment. Under Reserve Bank of India rules, your bank may ask you to approve
          some renewals (for example, renewals above ₹15,000); a renewal is not charged until you approve it.
        </p>
      </>
    ),
  },
  {
    id: "cancel",
    title: "Cancelling",
    content: (
      <>
        <p>
          You can cancel at any time from the <strong>Billing</strong> page in the app. If you can&rsquo;t, email{" "}
          <SupportEmail subject="Cancel subscription" /> from your account email address.
        </p>
        <p>
          <strong>Cancellation takes effect immediately.</strong> When you cancel, your subscription stops renewing
          and your workspace&rsquo;s paid access ends at that time, even if part of the current billing period
          remains. The app asks you to confirm before cancelling. Your workspace and data are not deleted by
          cancelling; you keep access to them within the limits that apply without a paid plan.
        </p>
        <p>
          To avoid being charged for the next period, cancel before your renewal date. Cancelling stops all future
          charges for that subscription through Razorpay.
        </p>
      </>
    ),
  },
  {
    id: "refunds",
    title: "Refunds",
    content: (
      <>
        <p>
          Because cancellation stops future charges, <strong>payments already made are generally not
          refundable</strong>, including for unused time in a billing period, unused plan capacity, or a period in
          which you didn&rsquo;t use the Service. We don&rsquo;t provide partial or prorated refunds when you cancel
          or change plans.
        </p>
        <p>We will refund a payment where:</p>
        <ul>
          <li>you were charged more than once for the same subscription period;</li>
          <li>you were charged after a cancellation that had already taken effect;</li>
          <li>you were charged an amount different from the amount shown to you at checkout; or</li>
          <li>a refund is required by applicable law.</li>
        </ul>
        <p>
          We may, at our discretion, consider other refund requests, for example where a significant failure of the
          Service on our side prevented you from using it.
        </p>
        <p>
          Accounts suspended or terminated for breach of our <Link href="/terms">Terms of Service</Link> or{" "}
          <Link href="/acceptable-use">Acceptable Use Policy</Link> are not eligible for a refund.
        </p>
      </>
    ),
  },
  {
    id: "request",
    title: "How to request a refund",
    content: (
      <>
        <p>
          Email <SupportEmail subject="Refund request" /> from your account email address and include the date and
          amount of the payment, the Razorpay payment or subscription reference if you have it, and the reason for
          the request.
        </p>
        <p>
          Approved refunds are made to the original payment method through Razorpay. After a refund is issued, it
          usually takes several working days to appear, depending on your bank or payment method.
        </p>
      </>
    ),
  },
  {
    id: "failed-payments",
    title: "Failed payments",
    content: (
      <p>
        If a renewal payment fails or isn&rsquo;t approved, your subscription may be paused or ended and paid
        features may become unavailable until a successful payment. Contact{" "}
        <SupportEmail subject="Billing" /> if you think a payment has been handled incorrectly.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    content: (
      <p>
        We may update this policy. Changes do not affect payments made before the update. This policy forms part of
        our <Link href="/terms">Terms of Service</Link>.
      </p>
    ),
  },
];

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      href="/refund-policy"
      title="Refund & Cancellation Policy"
      summary={
        <p>
          You can cancel your Polimatiq subscription at any time. Cancellation takes effect immediately and stops
          future charges. Payments already made are generally non-refundable, except in the cases listed below.
        </p>
      }
      sections={sections}
    />
  );
}
