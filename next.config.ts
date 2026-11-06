import type { NextConfig } from "next";

// Phase 3B Enterprise Readiness (security audit, item 8): baseline security
// headers on every response. Deliberately not a Content-Security-Policy —
// this app redirects through three third-party origins (Stripe Checkout/
// Portal, Google OAuth, Microsoft OAuth) plus next/image optimization, and a
// too-strict CSP written without enumerating every one of those first is the
// easiest way to silently break billing or a mailbox connect flow. CSP is
// scoped as its own follow-up once those origins are catalogued end to end.
//
// The CSP below is the safe subset that needs no origin catalogue: it only
// restricts framing, <base> and plugins, never where scripts, styles,
// images or redirects may come from — so it can't break Razorpay, Stripe,
// OAuth or next/image, while still closing clickjacking (frame-ancestors
// supersedes X-Frame-Options in modern browsers), <base>-tag hijacking and
// legacy plugin content (OWASP A05).
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  // No feature this app uses needs these; denying them limits what any
  // injected or third-party script could reach.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()" },
  // Isolates the browsing context from cross-origin windows, while still
  // letting the Razorpay checkout and OAuth popups talk back to the opener.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version in an X-Powered-By header.
  poweredByHeader: false,
  // Next.js 16 logs every Server Function invocation's arguments to the dev
  // terminal by default (see logging.serverFunctions in the Next.js docs).
  // Several Server Functions in this app take raw SMTP/IMAP passwords as
  // arguments (app/(app)/mailboxes/actions.ts) — that default would print
  // plaintext mailbox credentials to the terminal/log on every call. Off
  // entirely rather than scoped per-route, since no Server Function in this
  // codebase should ever have its arguments logged.
  logging: {
    serverFunctions: false,
  },
  experimental: {
    serverActions: {
      // Server Function request bodies default to 1MB — too small for
      // uploadAttachmentAction (app/(app)/campaigns/[campaignId]/actions.ts),
      // which accepts a file up to MAX_ATTACHMENT_SIZE_BYTES (8MiB — see
      // lib/email/attachment-validation.ts). Sized for that limit plus
      // multipart/form-data overhead (boundaries/part headers — the docs'
      // own rule of thumb is 10-20KB), rounded up.
      bodySizeLimit: "9mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
