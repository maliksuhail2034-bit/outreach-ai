import { afterEach, describe, expect, it, vi } from "vitest";
import { VerificationError } from "../provider";
import { MillionVerifierProvider } from "./millionverifier";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("MillionVerifierProvider", () => {
  it("maps a valid result to status 'valid' with a derived risk score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          email: "info@email.com",
          quality: "good",
          result: "ok",
          resultcode: 1,
          subresult: "ok",
          free: false,
          role: false,
          didyoumean: "",
          credits: 100,
          executiontime: 500,
          error: "",
          livemode: true,
        }),
      ),
    );

    const provider = new MillionVerifierProvider("test-key");
    const result = await provider.verify("info@email.com");

    expect(result.status).toBe("valid");
    expect(result.riskScore).toBe(100);
    expect(result.detail.disposable).toBe(false);
  });

  it("maps a catch_all result to status 'catch_all'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ result: "catch_all", resultcode: 2, quality: "risky", error: "" }),
      ),
    );

    const provider = new MillionVerifierProvider("test-key");
    const result = await provider.verify("info@email.com");

    expect(result.status).toBe("catch_all");
    expect(result.riskScore).toBe(50);
  });

  it("maps a disposable result to status 'invalid' and flags detail.disposable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ result: "disposable", resultcode: 5, quality: "bad", error: "" })),
    );

    const provider = new MillionVerifierProvider("test-key");
    const result = await provider.verify("test@mailinator.com");

    expect(result.status).toBe("invalid");
    expect(result.detail.disposable).toBe(true);
  });

  it("classifies an invalid API key error as invalid_key, not retryable", async () => {
    // mockImplementation (not mockResolvedValue) so each call gets a fresh
    // Response — this provider branches on parsed JSON body, not HTTP
    // status, so a reused (already-consumed) body would misclassify the
    // second call.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ result: "", resultcode: 4, error: "Apikey not found" }))),
    );

    const provider = new MillionVerifierProvider("bad-key");
    await expect(provider.verify("info@email.com")).rejects.toBeInstanceOf(VerificationError);
    await expect(provider.verify("info@email.com")).rejects.toMatchObject({ outcome: "invalid_key" });
  });

  it("classifies an insufficient credits error as invalid_key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ result: "", resultcode: 4, error: "Insufficient credits" })),
    );

    const provider = new MillionVerifierProvider("test-key");
    await expect(provider.verify("info@email.com")).rejects.toMatchObject({ outcome: "invalid_key" });
  });

  it("classifies an unrecognized account error as failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ result: "", resultcode: 4, error: "IP address blocked" })),
    );

    const provider = new MillionVerifierProvider("test-key");
    await expect(provider.verify("info@email.com")).rejects.toMatchObject({ outcome: "failed" });
  });

  it("classifies a network error as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const provider = new MillionVerifierProvider("test-key");
    await expect(provider.verify("info@email.com")).rejects.toMatchObject({ outcome: "retry" });
  });

  it("falls back to 'unknown' for an unrecognized result value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ result: "something_new", error: "" })));

    const provider = new MillionVerifierProvider("test-key");
    const result = await provider.verify("info@email.com");

    expect(result.status).toBe("unknown");
  });
});
