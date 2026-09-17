// Turns already-downloaded attachment bytes into the exact shape
// lib/email/provider.ts's OutboundEmailMessage.attachments expects — the one
// place send-worker.ts's real send path decides which downloaded
// attachments are actually safe to include. Pure (no Supabase/storage
// import) so this is unit-testable without a DB or a storage mock:
// send-worker.ts owns fetching the metadata row and downloading the bytes,
// this module only judges the result.
import type { Tables } from "@/types/database.types";
import { MAX_TOTAL_ATTACHMENT_BYTES_PER_STEP, validateAttachmentBytes } from "./attachment-validation";

export interface DownloadedAttachment {
  metadata: Tables<"email_attachments">;
  // null means the download failed or the storage object is missing —
  // handled the same as a failed re-validation (skipped, not fatal).
  bytes: Uint8Array | null;
}

export interface ProviderAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface AttachmentPayloadResult {
  attachments: ProviderAttachment[];
  // Human-readable, safe to log — never surfaced to the recipient or (today)
  // to the sending user; a problem with one attachment is logged and that
  // attachment is dropped, but never fails the whole send (see module doc).
  warnings: string[];
}

// Re-validates every attachment's actual bytes against the same rules
// enforced at upload time (lib/email/attachment-validation.ts) before it's
// allowed anywhere near an outgoing send — defense in depth against a row
// whose stored metadata no longer matches reality (a missing/corrupted
// object, a limit lowered after upload). A problem with one attachment never
// fails the whole send: it's dropped and reported in `warnings`, and the
// email still goes out with whatever attachments did pass, or with none.
export function buildAttachmentPayload(downloaded: DownloadedAttachment[]): AttachmentPayloadResult {
  const attachments: ProviderAttachment[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;

  for (const { metadata, bytes } of downloaded) {
    const label = `"${metadata.file_name}" (${metadata.id})`;

    if (!bytes) {
      warnings.push(`Attachment ${label} could not be downloaded — skipped.`);
      continue;
    }

    const validation = validateAttachmentBytes(bytes);
    if (!validation.ok) {
      warnings.push(`Attachment ${label} failed re-validation (${validation.reason}) — skipped.`);
      continue;
    }

    if (totalBytes + bytes.byteLength > MAX_TOTAL_ATTACHMENT_BYTES_PER_STEP) {
      warnings.push(`Attachment ${label} skipped — this step's total attachment size would exceed the limit.`);
      continue;
    }
    totalBytes += bytes.byteLength;

    attachments.push({
      filename: metadata.file_name,
      content: Buffer.from(bytes),
      contentType: validation.mimeType,
    });
  }

  return { attachments, warnings };
}
