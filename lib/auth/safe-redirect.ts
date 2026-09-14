// Guards against an open redirect (CWE-601) via a `next`/`redirect_to`-style
// query parameter — used by app/auth/confirm/route.ts, whose `next` comes
// straight off an incoming request's query string and is otherwise
// completely attacker-controlled (an attacker can request a real password
// reset for an email they control, then send the resulting valid link to a
// victim with `next` swapped to an external URL; Next.js's `redirect()`
// supports redirecting to a fully-qualified external URL, so an unvalidated
// `next` would genuinely send the victim's browser there after a real,
// successful token verification).
//
// Deliberately only allows a same-origin relative path, rejecting the two
// real bypass shapes browsers resolve as external even though they start
// with "/": a protocol-relative URL ("//evil.com" -> resolves to
// "https://evil.com") and its backslash variant ("/\evil.com", which every
// major browser normalizes to "//evil.com" before navigating).
export function isSafeRedirectPath(next: string | null): next is string {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//") || next.startsWith("/\\")) return false;
  return true;
}

// Resolves an untrusted `next` value to a safe redirect target, falling
// back to `fallback` for anything isSafeRedirectPath rejects (including
// null/empty).
export function resolveSafeRedirectPath(next: string | null, fallback: string): string {
  return isSafeRedirectPath(next) ? next : fallback;
}
