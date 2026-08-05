import { headers } from "next/headers";

// Best-effort client IP for the unauthenticated rate-limit scopes
// (auth:sign_in/sign_up/forgot_password) — there's no session yet, so no
// user/organization id to key on. Vercel always sets x-forwarded-for in
// production; the "unknown" fallback only matters for local/direct testing,
// where every such request shares one bucket rather than being unlimited.
export async function getClientIp(): Promise<string> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return "unknown";
}
