// A readable message from anything thrown. lib/db re-throws Supabase/
// PostgREST errors as the plain objects the client returns ({ message,
// details, hint, code }), not Error instances, so an `instanceof Error`
// check alone reports them as unknown. Only a `message` string is ever read
// — never the object itself, whose other fields (details, hint, payloads)
// can carry row data — and the result is capped so an oversized message
// can't flood a log line or an alert.
const MAX_LENGTH = 500;

export function errorMessage(error: unknown, fallback: string): string {
  const message = readMessage(error) ?? (isObject(error) ? readMessage(error.error) : null);
  if (!message) return fallback;
  return message.length > MAX_LENGTH ? `${message.slice(0, MAX_LENGTH - 1)}…` : message;
}

function readMessage(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (isObject(value) && typeof value.message === "string") return value.message.trim() || null;
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
