import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyRazorpayWebhookSignature } from "./razorpay";

const WEBHOOK_SECRET = "test_webhook_secret";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyRazorpayWebhookSignature", () => {
  it("accepts a payload with a genuinely valid signature", () => {
    const payload = JSON.stringify({ event: "subscription.activated" });
    const signature = sign(payload, WEBHOOK_SECRET);

    expect(verifyRazorpayWebhookSignature(payload, signature, WEBHOOK_SECRET)).toBe(true);
  });

  it("rejects a payload that was tampered with after signing", () => {
    const payload = JSON.stringify({ event: "subscription.activated" });
    const signature = sign(payload, WEBHOOK_SECRET);

    const tamperedPayload = JSON.stringify({ event: "subscription.cancelled" });

    expect(verifyRazorpayWebhookSignature(tamperedPayload, signature, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a signature produced with a different webhook secret", () => {
    const payload = JSON.stringify({ event: "subscription.activated" });
    const signature = sign(payload, "a_different_secret");

    expect(verifyRazorpayWebhookSignature(payload, signature, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a malformed (non-hex, wrong-length) signature without throwing", () => {
    const payload = JSON.stringify({ event: "subscription.activated" });

    expect(verifyRazorpayWebhookSignature(payload, "not-a-real-signature", WEBHOOK_SECRET)).toBe(false);
  });
});

describe("getRazorpayClient", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it("throws a clear error when Razorpay credentials aren't configured", async () => {
    // getRazorpayClient() caches a singleton on first successful call — a
    // fresh module instance is needed to actually exercise the
    // "never yet constructed" path, same reasoning
    // lib/billing/stripe.test.ts's equivalent test documents.
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    vi.resetModules();
    const { getRazorpayClient: freshGetRazorpayClient } = await import("./razorpay");
    expect(() => freshGetRazorpayClient()).toThrow(/RAZORPAY_KEY_ID|RAZORPAY_KEY_SECRET/);
  });
});
