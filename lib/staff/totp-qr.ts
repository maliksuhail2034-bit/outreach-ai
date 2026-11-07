// Supabase returns the TOTP QR code as a raw, unencoded SVG data URI with a
// trailing newline ("data:image/svg+xml;utf-8,<?xml …?>\n<svg …>…</svg>\n").
// next/image rejects a src ending in whitespace, which crashed the 2-step
// setup page, and raw "#"/"%" characters in an unencoded data URI can also
// truncate the image. Re-encode the SVG body so the URI is always valid.
const SVG_PREFIX = /^data:image\/svg\+xml(?:;(?:utf-8|charset=utf-8))?,/i;

export function totpQrDataUri(qr: string): string {
  const value = qr.trim();
  const prefix = value.match(SVG_PREFIX);
  if (!prefix) return value;
  const body = value.slice(prefix[0].length);
  // Already percent-encoded (no raw markup): keep it as it is.
  if (!body.includes("<")) return value;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body.trim())}`;
}
