// The app's page routes that count as visits on the Traffic page. A path
// that matches none of these (a typo, a deleted page, a bot probing
// /wp-admin or /.env) gets a 404 from the app and isn't counted.
//
// proxy.ts runs before Next.js resolves the route, so it can't see the
// response status; this list is the stand-in. lib/traffic/routes.test.ts
// compares it with every app/**/page.tsx and fails when a page is added or
// removed without updating it. Staff console pages are never counted.
//
// Route groups like (app) don't appear in URLs; [param] matches any one
// path segment.
export const COUNTED_ROUTES = [
  "/",
  "/acceptable-use",
  "/analytics",
  "/billing",
  "/campaigns",
  "/campaigns/[campaignId]",
  "/campaigns/[campaignId]/analytics",
  "/campaigns/compare",
  "/dashboard",
  "/forgot-password",
  "/inbox",
  "/inbox/[replyId]",
  "/leads",
  "/leads/[leadId]",
  "/login",
  "/mailboxes",
  "/mailboxes/[mailboxId]/analytics",
  "/mailboxes/compare",
  "/privacy",
  "/refund-policy",
  "/reset-password",
  "/settings",
  "/settings/ai",
  "/settings/deliverability",
  "/settings/deliverability/[domainId]/analytics",
  "/settings/deliverability/compare",
  "/settings/integrations",
  "/settings/verification",
  "/signup",
  "/support",
  "/terms",
  "/unsubscribe/[token]",
  "/warmup",
] as const;

function toPattern(route: string): RegExp {
  if (route === "/") return /^\/$/;
  const segments = route
    .split("/")
    .filter(Boolean)
    .map((segment) => (/^\[[^\]]+\]$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return new RegExp(`^/${segments.join("/")}$`);
}

const PATTERNS = COUNTED_ROUTES.map(toPattern);

// Whether a request path is one of the app's pages (trailing slash and
// letter case ignored, as the app's own routing does for these paths).
export function isCountedRoute(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PATTERNS.some((pattern) => pattern.test(path));
}
