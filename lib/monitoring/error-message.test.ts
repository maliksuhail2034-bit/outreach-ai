import { describe, expect, it } from "vitest";
import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  it("reads an Error's message", () => {
    expect(errorMessage(new Error("connection reset"), "fallback")).toBe("connection reset");
  });

  it("reads a plain PostgREST-style error object's message", () => {
    const dbError = { message: 'relation "public.x" does not exist', details: null, hint: null, code: "42P01" };
    expect(errorMessage(dbError, "fallback")).toBe('relation "public.x" does not exist');
  });

  it("reads a nested { error: { message } } shape", () => {
    expect(errorMessage({ error: { message: "JWT expired" } }, "fallback")).toBe("JWT expired");
  });

  it("uses a thrown string as-is", () => {
    expect(errorMessage("timeout", "fallback")).toBe("timeout");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["an object without a message", { code: "PGRST116" }],
    ["an empty message", new Error("")],
    ["a whitespace-only string", "   "],
    ["a non-string message", { message: { nested: true } }],
  ])("falls back for %s", (_label, value) => {
    expect(errorMessage(value, "Unknown error.")).toBe("Unknown error.");
  });

  it("never includes other fields of the error object", () => {
    const dbError = {
      message: "duplicate key value violates unique constraint",
      details: "Key (email)=(person@example.com) already exists.",
      hint: "token=secret-value",
      code: "23505",
    };
    const message = errorMessage(dbError, "fallback");
    expect(message).toBe("duplicate key value violates unique constraint");
    expect(message).not.toContain("person@example.com");
    expect(message).not.toContain("secret-value");
  });

  it("caps an oversized message", () => {
    const message = errorMessage(new Error("x".repeat(2000)), "fallback");
    expect(message).toHaveLength(500);
    expect(message.endsWith("…")).toBe(true);
  });
});
