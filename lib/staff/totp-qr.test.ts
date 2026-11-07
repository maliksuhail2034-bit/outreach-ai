import { describe, expect, it } from "vitest";

import { totpQrDataUri } from "./totp-qr";

const RAW = `data:image/svg+xml;utf-8,<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#000" d="M0 0h1v1H0z"/></svg>\n`;

describe("totpQrDataUri", () => {
  it("encodes Supabase's raw SVG data URI and drops the trailing newline", () => {
    const uri = totpQrDataUri(RAW);
    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(uri).not.toMatch(/\s$/);
    expect(uri).not.toMatch(/[<>#\s]/);
    expect(decodeURIComponent(uri.slice("data:image/svg+xml;charset=utf-8,".length))).toContain('fill="#000"');
  });

  it("leaves an already-encoded or non-SVG URI alone apart from trimming", () => {
    expect(totpQrDataUri("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E \n")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
    expect(totpQrDataUri("data:image/png;base64,AAAA\n")).toBe("data:image/png;base64,AAAA");
  });
});
