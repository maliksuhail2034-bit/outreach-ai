import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { verifyStripeWebhookSignature } from "./stripe";

// A syntactically-valid-looking test key — no network call happens for any
// of this (signature generation/verification is pure HMAC, not an API
// call), so this never needs to be a real Stripe key.
const FAKE_SECRET_KEY = "sk_test_fake_key_for_signature_tests";
const WEBHOOK_SECRET = "whsec_test_secret";

describe("verifyStripeWebhookSignature", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = FAKE_SECRET_KEY;
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("accepts a payload with a genuinely valid signature", () => {
    const payload = JSON.stringify({ id: "evt_test", type: "customer.subscription.updated" });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    const event = verifyStripeWebhookSignature(payload, header, WEBHOOK_SECRET);

    expect(event.id).toBe("evt_test");
    expect(event.type).toBe("customer.subscription.updated");
  });

  it("rejects a payload that was tampered with after signing", () => {
    const payload = JSON.stringify({ id: "evt_test", type: "customer.subscription.updated" });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    const tamperedPayload = JSON.stringify({ id: "evt_test", type: "customer.subscription.deleted" });

    expect(() => verifyStripeWebhookSignature(tamperedPayload, header, WEBHOOK_SECRET)).toThrow();
  });

  it("rejects a signature produced with a different webhook secret", () => {
    const payload = JSON.stringify({ id: "evt_test", type: "customer.subscription.updated" });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_a_different_secret" });

    expect(() => verifyStripeWebhookSignature(payload, header, WEBHOOK_SECRET)).toThrow();
  });

  it("rejects a malformed signature header without throwing something other than a normal Error", () => {
    const payload = JSON.stringify({ id: "evt_test", type: "customer.subscription.updated" });

    expect(() => verifyStripeWebhookSignature(payload, "not-a-real-signature-header", WEBHOOK_SECRET)).toThrow();
  });
});

describe("getStripeClient", () => {
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("throws a clear error when STRIPE_SECRET_KEY isn't configured", async () => {
    // getStripeClient() caches a singleton on first successful call — the
    // tests above already trigger that (via verifyStripeWebhookSignature),
    // so this needs a fresh module instance to actually exercise the
    // "never yet constructed" path instead of returning the cached client.
    delete process.env.STRIPE_SECRET_KEY;
    vi.resetModules();
    const { getStripeClient: freshGetStripeClient } = await import("./stripe");
    expect(() => freshGetStripeClient()).toThrow(/STRIPE_SECRET_KEY/);
  });
});
