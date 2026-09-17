// Pure validation/sanitization for email attachments (PDF/PNG/JPEG/WEBP) —
// no Supabase, no storage, no DB. Shared by the upload Server Function
// (app/(app)/campaigns/[campaignId]/actions.ts), the send worker
// (lib/email/send-worker.ts), and the composer's client-side pre-check, so
// there's exactly one definition of "is this attachment allowed" reused at
// every point the file's bytes or declared metadata pass through this app.

// Private Supabase Storage bucket created in
// supabase/migrations/20260917100000_email_attachments.sql. One constant so
// the upload/delete Server Functions (app/(app)/campaigns/[campaignId]/actions.ts)
// and the send worker (lib/email/send-worker.ts) can never drift to
// different bucket names.
export const ATTACHMENTS_BUCKET = "attachments";

export type SupportedAttachmentMimeType = "application/pdf" | "image/png" | "image/jpeg" | "image/webp";

export const ALLOWED_ATTACHMENT_MIME_TYPES: readonly SupportedAttachmentMimeType[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

// 8 MiB per file. Gmail/Outlook cap a whole message (all attachments,
// base64-encoded — roughly +37% over raw bytes) around 20-25MB; this leaves
// real headroom under that even with several files attached (see
// MAX_ATTACHMENTS_PER_STEP/MAX_TOTAL_ATTACHMENT_BYTES_PER_STEP below), and
// comfortably fits under the local Supabase Storage default
// (supabase/config.toml's [storage].file_size_limit = 50MiB) and the
// "attachments" bucket's own file_size_limit set in the same migration that
// creates it (20260917100000_email_attachments.sql) — three independent
// backstops all agreeing on the same number.
export const MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024;

// Keeps a single step's total attachment payload well under the ~20-25MB
// provider ceiling even after base64 inflation: 15 MiB raw -> ~20.5MB
// encoded, leaving room for the email body/headers themselves.
export const MAX_TOTAL_ATTACHMENT_BYTES_PER_STEP = 15 * 1024 * 1024;

export const MAX_ATTACHMENTS_PER_STEP = 5;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

// Identifies a file by its actual leading bytes ("magic numbers"), never by
// a client-supplied filename or Content-Type — both are attacker-controlled
// and routinely wrong/lied about. Returns null for anything that doesn't
// match one of the four supported formats, regardless of what the browser
// claimed. This is the server-side type check requirement (Batch 3 §1) —
// deliberately hand-rolled for exactly these four well-known, simple
// signatures rather than pulling in a file-type-sniffing dependency for a
// four-way check.
export function sniffAttachmentMimeType(bytes: Uint8Array): SupportedAttachmentMimeType | null {
  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  // \x89PNG\r\n\x1a\n
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // \xFF\xD8\xFF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF"...."WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

// Strips everything that could turn a file name into a path — separators,
// traversal segments, null/control bytes — before it's ever used to build a
// storage object key (uploadAttachmentAction). Never trust a client-supplied
// file name as a path component as-is.
function stripControlCharacters(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) result += char;
  }
  return result;
}

const BACKSLASH = String.fromCharCode(92);
const DISALLOWED_CHAR_PATTERN = /[^A-Za-z0-9._ -]/g;
const REPEATED_DOT_PATTERN = /[.]{2,}/g;

// Avoids a regex literal containing a literal backslash (a "\\" inside a
// character class is easy to get subtly wrong across different ways of
// authoring/escaping this file) — a plain lastIndexOf on both possible
// separators is just as correct and impossible to mis-escape.
function baseName(path: string): string {
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf(BACKSLASH));
  return lastSeparator === -1 ? path : path.slice(lastSeparator + 1);
}

export function sanitizeAttachmentFileName(rawName: string): string {
  const base = baseName(rawName);
  const stripped = stripControlCharacters(base).trim();
  const safe = stripped
    .replace(DISALLOWED_CHAR_PATTERN, "_")
    // Collapses any run of 2+ dots (".." anywhere, not just at the start) —
    // belt-and-suspenders against path traversal on top of the base-name
    // split above, since this sanitized name becomes a segment of the
    // storage object key (uploadAttachmentAction), never a real filesystem
    // path, but nothing here should ever contain "..".
    .replace(REPEATED_DOT_PATTERN, "_")
    .slice(0, 150);
  return safe || "attachment";
}

// Object key for a newly-uploaded attachment: "<uploading-user-id>/<uuid>-
// <sanitized file name>" — the storage.objects RLS policies (same migration)
// check (storage.foldername(name))[1] against auth.uid(), so the user_id
// prefix isn't just organizational, it's the entire access-control boundary
// for the storage layer.
export function buildAttachmentStoragePath(userId: string, sanitizedFileName: string): string {
  return `${userId}/${crypto.randomUUID()}-${sanitizedFileName}`;
}

export interface AttachmentValidationOk {
  ok: true;
  mimeType: SupportedAttachmentMimeType;
}

export interface AttachmentValidationError {
  ok: false;
  reason: string;
}

export type AttachmentValidationResult = AttachmentValidationOk | AttachmentValidationError;

// The one check both the upload action and the send worker run before
// trusting an attachment's bytes — size first (cheap), then a real content
// sniff (ignores whatever MIME type the caller claims). Never returns a
// stack trace or internal detail, only a message safe to show a user.
export function validateAttachmentBytes(bytes: Uint8Array): AttachmentValidationResult {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: "This file is empty." };
  }
  if (bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return { ok: false, reason: `Files must be ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} or smaller.` };
  }
  const mimeType = sniffAttachmentMimeType(bytes);
  if (!mimeType) {
    return { ok: false, reason: "Unsupported file type. Attach a PDF, PNG, JPG, or WEBP file." };
  }
  return { ok: true, mimeType };
}
