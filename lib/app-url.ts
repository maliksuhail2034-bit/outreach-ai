// Absolute URLs on this app's own public origin, for server-side redirects.
//
// Never build a redirect from `request.url`: behind a reverse proxy (Caddy on
// the VPS, see docs/self-hosting.md) Next.js sees the internal listener, so
// `new URL("/mailboxes", request.url)` became https://localhost:3001/mailboxes
// and sent users to a page that doesn't exist. NEXT_PUBLIC_APP_URL is the
// configured public origin and the only trusted source for it.
//
// Fails closed: an unset or invalid NEXT_PUBLIC_APP_URL throws instead of
// silently falling back to the request's (internal or client-supplied) host.

export class AppUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppUrlConfigError";
  }
}

export function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) throw new AppUrlConfigError("NEXT_PUBLIC_APP_URL is not set — required to build redirect URLs.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppUrlConfigError("NEXT_PUBLIC_APP_URL is not a valid absolute URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AppUrlConfigError("NEXT_PUBLIC_APP_URL must be an http(s) URL.");
  }
  return parsed.origin;
}

// `path` must be an app-relative path ("/mailboxes?x=1"). Anything that
// would resolve to another origin ("//evil.example", "https://…") is
// refused, so this can't become an open redirect even if a caller one day
// passes user input.
export function appUrl(path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    throw new Error(`appUrl expects an app-relative path, got "${path}".`);
  }
  const origin = appOrigin();
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error(`appUrl path "${path}" resolved off-origin.`);
  return url;
}
