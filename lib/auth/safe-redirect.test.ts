import { describe, expect, it } from "vitest";
import { isSafeRedirectPath, resolveSafeRedirectPath } from "./safe-redirect";

describe("isSafeRedirectPath", () => {
  it("accepts a plain relative path", () => {
    expect(isSafeRedirectPath("/dashboard")).toBe(true);
  });

  it("accepts a relative path with query params", () => {
    expect(isSafeRedirectPath("/reset-password?foo=bar")).toBe(true);
  });

  it("rejects null", () => {
    expect(isSafeRedirectPath(null)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSafeRedirectPath("")).toBe(false);
  });

  it("rejects a fully-qualified external URL", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
  });

  it("rejects a scheme-relative path without a leading slash", () => {
    expect(isSafeRedirectPath("evil.com")).toBe(false);
  });

  it("rejects a protocol-relative URL", () => {
    expect(isSafeRedirectPath("//evil.com")).toBe(false);
  });

  it("rejects a protocol-relative URL with a path after the host", () => {
    expect(isSafeRedirectPath("//evil.com/phish")).toBe(false);
  });

  it("rejects the backslash protocol-relative variant", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
  });

  it("rejects a javascript: URL", () => {
    expect(isSafeRedirectPath("javascript:alert(1)")).toBe(false);
  });
});

describe("resolveSafeRedirectPath", () => {
  it("returns the value when it's a safe relative path", () => {
    expect(resolveSafeRedirectPath("/dashboard", "/login")).toBe("/dashboard");
  });

  it("falls back for an unsafe value", () => {
    expect(resolveSafeRedirectPath("https://evil.com", "/login")).toBe("/login");
  });

  it("falls back for null", () => {
    expect(resolveSafeRedirectPath(null, "/login")).toBe("/login");
  });
});
