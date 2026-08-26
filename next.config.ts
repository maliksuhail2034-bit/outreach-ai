import type { NextConfig } from "next";

// Phase 3B Enterprise Readiness (security audit, item 8): baseline security
// headers on every response. Deliberately not a Content-Security-Policy —
// this app redirects through three third-party origins (Stripe Checkout/
// Portal, Google OAuth, Microsoft OAuth) plus next/image optimization, and a
// too-strict CSP written without enumerating every one of those first is the
// easiest way to silently break billing or a mailbox connect flow. CSP is
// scoped as its own follow-up once those origins are catalogued end to end.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
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
