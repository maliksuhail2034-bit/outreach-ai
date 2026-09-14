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
// Deliberately only allows a same-origin relative path, rejecting the real
// bypass shapes browsers resolve as external even though they start with
// "/": a protocol-relative URL ("//evil.com" -> resolves to
// "https://evil.com"), its backslash variant ("/\evil.com", which every
// major browser normalizes to "//evil.com" before navigating), and the same
// two shapes hidden behind an ASCII tab/newline/CR ("/\t/evil.com",
// "/\n/evil.com", "/\r/evil.com", anywhere in the string, not just right
// after the leading slash).
//
// The tab/newline/CR case is not theoretical — confirmed exploitable
// end-to-end against a real Chrome browser with a genuine, valid Supabase
// recovery token: app/auth/confirm/route.ts's redirect(next) put
// "/\t/evil.com" verbatim into the Location header, and Chrome navigated to
// http://evil.com. This is the WHATWG URL Standard's own first parsing
// step ("remove all ASCII tab or newline") — every browser strips these
// characters from anywhere in a URL before resolving it, so validation must
// check the same stripped form the browser will actually see, not the raw
// string, or a check for a leading "//"/"/\\" is trivially bypassed by
// splitting it with a stripped character.
export function isSafeRedirectPath(next: string | null): next is string {
  if (!next) return false;
  const stripped = next.replace(/[\t\n\r]/g, "");
  if (!stripped.startsWith("/")) return false;
  if (stripped.startsWith("//") || stripped.startsWith("/\\")) return false;
  return true;
}

// Resolves an untrusted `next` value to a safe redirect target, falling
// back to `fallback` for anything isSafeRedirectPath rejects (including
// null/empty).
export function resolveSafeRedirectPath(next: string | null, fallback: string): string {
  return isSafeRedirectPath(next) ? next : fallback;
}
