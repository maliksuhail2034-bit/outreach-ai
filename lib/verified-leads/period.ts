// Calendar-month allocation periods (UTC), e.g. "2026-11".

export function periodFor(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function todayIsoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// Masked display form of an address: first character of the local part,
// then bullets, then the domain — "jane@acme.com" -> "j••••@acme.com".
// Mirrors the SQL in allocate_verified_leads().
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "••••";
  return `${email.slice(0, 1)}••••${email.slice(at)}`;
}
