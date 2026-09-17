import { describe, expect, it } from "vitest";
import { buildAttachmentPayload, type DownloadedAttachment } from "./attachment-payload";
import { MAX_ATTACHMENT_SIZE_BYTES } from "./attachment-validation";
import type { Tables } from "@/types/database.types";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeMetadata(overrides: Partial<Tables<"email_attachments">> = {}): Tables<"email_attachments"> {
  return {
    id: "attachment-1",
    user_id: "user-1",
    sequence_step_id: "step-1",
    file_name: "proposal.pdf",
    mime_type: "application/pdf",
    size_bytes: PDF_BYTES.byteLength,
    storage_path: "user-1/uuid-proposal.pdf",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildAttachmentPayload", () => {
  it("includes a valid downloaded attachment in the provider payload", () => {
    const downloaded: DownloadedAttachment[] = [{ metadata: makeMetadata(), bytes: PDF_BYTES }];
    const result = buildAttachmentPayload(downloaded);

    expect(result.attachments).toEqual([
      { filename: "proposal.pdf", content: Buffer.from(PDF_BYTES), contentType: "application/pdf" },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("includes multiple valid attachments", () => {
    const downloaded: DownloadedAttachment[] = [
      { metadata: makeMetadata({ id: "a", file_name: "one.pdf" }), bytes: PDF_BYTES },
      { metadata: makeMetadata({ id: "b", file_name: "two.png", mime_type: "image/png" }), bytes: PNG_BYTES },
    ];
    const result = buildAttachmentPayload(downloaded);

    expect(result.attachments).toHaveLength(2);
    expect(result.attachments.map((a) => a.filename)).toEqual(["one.pdf", "two.png"]);
    expect(result.warnings).toEqual([]);
  });

  it("handles a missing storage object safely — skips it, never throws, still returns other attachments", () => {
    const downloaded: DownloadedAttachment[] = [
      { metadata: makeMetadata({ id: "missing", file_name: "gone.pdf" }), bytes: null },
      { metadata: makeMetadata({ id: "present", file_name: "here.pdf" }), bytes: PDF_BYTES },
    ];
    const result = buildAttachmentPayload(downloaded);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("here.pdf");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("gone.pdf");
    expect(result.warnings[0]).toContain("could not be downloaded");
  });

  it("drops an attachment whose actual bytes no longer sniff as a supported type", () => {
    const downloaded: DownloadedAttachment[] = [
      { metadata: makeMetadata(), bytes: new TextEncoder().encode("not actually a pdf") },
    ];
    const result = buildAttachmentPayload(downloaded);

    expect(result.attachments).toEqual([]);
    expect(result.warnings[0]).toContain("failed re-validation");
  });

  it("drops an attachment whose actual bytes exceed the maximum size, even if metadata says otherwise", () => {
    const oversized = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1);
    oversized.set(PDF_BYTES, 0);
    const downloaded: DownloadedAttachment[] = [
      { metadata: makeMetadata({ size_bytes: PDF_BYTES.byteLength }), bytes: oversized },
    ];
    const result = buildAttachmentPayload(downloaded);

    expect(result.attachments).toEqual([]);
    expect(result.warnings[0]).toMatch(/failed re-validation/);
  });

  it("stops adding attachments once the per-step total size budget is exceeded", () => {
    const big = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES);
    big.set(PDF_BYTES, 0);
    const downloaded: DownloadedAttachment[] = [
      { metadata: makeMetadata({ id: "a" }), bytes: big },
      { metadata: makeMetadata({ id: "b" }), bytes: big },
      { metadata: makeMetadata({ id: "c" }), bytes: big },
    ];
    const result = buildAttachmentPayload(downloaded);

    // 8 MiB each, 15 MiB total budget — the third one can't fit.
    expect(result.attachments).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("exceed the limit"))).toBe(true);
  });

  it("returns no attachments and no warnings for an empty input", () => {
    expect(buildAttachmentPayload([])).toEqual({ attachments: [], warnings: [] });
  });
});
