// Canonicalizes an RFC 5322 Message-ID (or In-Reply-To/References entry) so
// outbound (send) and inbound (reply-sync) code compare identifiers in the
// same form regardless of which side put the surrounding angle brackets on:
// trims whitespace, strips a leading `<` / trailing `>` only if present,
// leaves the identifier itself untouched. No provider-specific assumptions —
// every mail provider's headers follow this same RFC shape.
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^</, "").replace(/>$/, "");
}
