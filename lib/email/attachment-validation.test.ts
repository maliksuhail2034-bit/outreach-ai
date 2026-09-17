import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  formatBytes,
  sanitizeAttachmentFileName,
  sniffAttachmentMimeType,
  validateAttachmentBytes,
} from "./attachment-validation";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x25]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x00, 0x00, 0x00, 0x00], 4); // chunk size (irrelevant here)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return bytes;
}

describe("sniffAttachmentMimeType", () => {
  it("recognizes a PDF by its %PDF- signature", () => {
    expect(sniffAttachmentMimeType(PDF_BYTES)).toBe("application/pdf");
  });

  it("recognizes a PNG by its signature", () => {
    expect(sniffAttachmentMimeType(PNG_BYTES)).toBe("image/png");
  });

  it("recognizes a JPEG by its signature", () => {
    expect(sniffAttachmentMimeType(JPEG_BYTES)).toBe("image/jpeg");
  });

  it("recognizes a WEBP by its RIFF....WEBP signature", () => {
    expect(sniffAttachmentMimeType(webpBytes())).toBe("image/webp");
  });

  it("returns null for an unrecognized file", () => {
    expect(sniffAttachmentMimeType(new TextEncoder().encode("plain text file"))).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(sniffAttachmentMimeType(new Uint8Array())).toBeNull();
  });

  it("does not trust a RIFF file that isn't actually WEBP", () => {
    const bytes = new Uint8Array(16);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    bytes.set([0x41, 0x56, 0x49, 0x20], 8); // "AVI " — a different RIFF format
    expect(sniffAttachmentMimeType(bytes)).toBeNull();
  });

  it("never trusts a claimed extension/MIME type over the actual bytes", () => {
    // A ".pdf"-named file whose content is plain text should not sniff as a PDF.
    const fakeBytes = new TextEncoder().encode("not actually a pdf");
    expect(sniffAttachmentMimeType(fakeBytes)).toBeNull();
  });
});

describe("validateAttachmentBytes", () => {
  it("accepts a valid PDF", () => {
    expect(validateAttachmentBytes(PDF_BYTES)).toEqual({ ok: true, mimeType: "application/pdf" });
  });

  it("accepts a valid PNG", () => {
    expect(validateAttachmentBytes(PNG_BYTES)).toEqual({ ok: true, mimeType: "image/png" });
  });

  it("accepts a valid JPEG", () => {
    expect(validateAttachmentBytes(JPEG_BYTES)).toEqual({ ok: true, mimeType: "image/jpeg" });
  });

  it("accepts a valid WEBP", () => {
    expect(validateAttachmentBytes(webpBytes())).toEqual({ ok: true, mimeType: "image/webp" });
  });

  it("rejects an unsupported file type", () => {
    const result = validateAttachmentBytes(new TextEncoder().encode("hello world"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported/i);
  });

  it("rejects an empty file", () => {
    const result = validateAttachmentBytes(new Uint8Array());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/empty/i);
  });

  it("rejects a file larger than the maximum size, even with a valid signature", () => {
    const big = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1);
    big.set(PDF_BYTES, 0);
    const result = validateAttachmentBytes(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/8\.0 MB or smaller/);
  });

  it("accepts a file exactly at the maximum size", () => {
    const exact = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES);
    exact.set(PDF_BYTES, 0);
    expect(validateAttachmentBytes(exact)).toEqual({ ok: true, mimeType: "application/pdf" });
  });
});

describe("sanitizeAttachmentFileName", () => {
  it("keeps an ordinary file name unchanged", () => {
    expect(sanitizeAttachmentFileName("proposal.pdf")).toBe("proposal.pdf");
  });

  it("strips a directory path down to the base name", () => {
    expect(sanitizeAttachmentFileName("../../etc/passwd")).toBe("passwd");
  });

  it("strips a Windows-style directory path down to the base name", () => {
    expect(sanitizeAttachmentFileName("C:\\Users\\me\\secret.pdf")).toBe("secret.pdf");
  });

  it("removes path traversal segments embedded in the name", () => {
    const result = sanitizeAttachmentFileName("..%2F..%2Fetc%2Fpasswd.pdf");
    expect(result).not.toContain("/");
    expect(result).not.toContain("..");
  });

  it("strips control characters and null bytes", () => {
    const withControlChars = `evil${String.fromCharCode(0)}${String.fromCharCode(7)}.pdf`;
    expect(sanitizeAttachmentFileName(withControlChars)).toBe("evil.pdf");
  });

  it("replaces disallowed characters instead of leaving them as-is", () => {
    expect(sanitizeAttachmentFileName("weird<>:\"|?*name.pdf")).toBe("weird_______name.pdf");
  });

  it("never returns a name starting with a dot (a hidden file / relative reference)", () => {
    expect(sanitizeAttachmentFileName("....pdf")).not.toMatch(/^\./);
  });

  it("caps an absurdly long file name", () => {
    const long = `${"a".repeat(500)}.pdf`;
    expect(sanitizeAttachmentFileName(long).length).toBeLessThanOrEqual(150);
  });

  it("falls back to a default name when nothing safe remains", () => {
    expect(sanitizeAttachmentFileName("../../")).toBe("attachment");
  });
});

describe("formatBytes", () => {
  it("formats bytes under 1KB as bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2 KB");
  });

  it("formats megabytes with one decimal place", () => {
    expect(formatBytes(8 * 1024 * 1024)).toBe("8.0 MB");
  });
});
