import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route-level tests. Signature verification and the SDK->entity mapping run
// for real; the seams mocked are the ones that would otherwise need a live
// database, a live Razorpay account, or a real alert destination.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/db", () => ({
  recordAuditEvent: vi.fn(),
}));
vi.mock("@/lib/db/billing-v2", () => ({
  hasPaymentWebhookEventBeenProcessed: vi.fn(),
  recordPaymentWebhookEventProcessed: vi.fn(),
}));
vi.mock("@/lib/billing/razorpay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/razorpay")>()),
  getRazorpayClient: vi.fn(),
}));
vi.mock("@/lib/billing/sync-subscription-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/sync-subscription-v2")>()),
  syncSubscriptionFromRazorpay: vi.fn(),
}));
vi.mock("@/lib/monitoring/error-tracking", () => ({
  captureError: vi.fn(),
}));

import { recordAuditEvent } from "@/lib/db";
import { hasPaymentWebhookEventBeenProcessed, recordPaymentWebhookEventProcessed } from "@/lib/db/billing-v2";
import { getRazorpayClient } from "@/lib/billing/razorpay";
import { syncSubscriptionFromRazorpay } from "@/lib/billing/sync-subscription-v2";
import { captureError } from "@/lib/monitoring/error-tracking";
import { POST } from "./route";

const mockHasProcessed = vi.mocked(hasPaymentWebhookEventBeenProcessed);
const mockRecordProcessed = vi.mocked(recordPaymentWebhookEventProcessed);
const mockGetRazorpayClient = vi.mocked(getRazorpayClient);
const mockSync = vi.mocked(syncSubscriptionFromRazorpay);
const mockCaptureError = vi.mocked(captureError);
const mockRecordAudit = vi.mocked(recordAuditEvent);

const SECRET = "test_webhook_secret";
const NOTES = { organization_id: "org-1", internal_plan_id: "starter", billing_interval: "1_month" };

// What Razorpay returns from subscriptions.fetch — the provider's CURRENT
// state, which is what the route must write.
function providerSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_abc123",
    entity: "subscription",
    plan_id: "plan_starter_1m",
    customer_id: "cust_1",
    status: "active",
    current_start: 1_800_000_000,
    current_end: 1_802_592_000,
    notes: NOTES,
    ...overrides,
  };
}

function webhookBody(event: string, entity: Record<string, unknown> = providerSubscription()) {
  return JSON.stringify({ entity: "event", event, payload: { subscription: { entity } }, created_at: 1_800_000_100 });
}

function sign(body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function webhookRequest(body: string, { eventId = "evt_1", signature = sign(body) }: { eventId?: string; signature?: string } = {}) {
  return new Request("http://localhost/api/webhooks/razorpay", {
    method: "POST",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId, "content-type": "application/json" },
    body,
  });
}

let fetchSubscription: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchSubscription = vi.fn(async () => providerSubscription());
  mockGetRazorpayClient.mockReturnValue({ subscriptions: { fetch: fetchSubscription } } as unknown as ReturnType<typeof getRazorpayClient>);
  mockHasProcessed.mockResolvedValue(false);
  mockSync.mockResolvedValue({ outcome: "synced", organizationId: "org-1", unrecognizedStatus: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/razorpay", () => {
  it("processes a valid event: re-fetches the subscription, syncs the fetched state, audits, and records the event", async () => {
    const response = await POST(webhookRequest(webhookBody("subscription.activated")));

    expect(response.status).toBe(200);
    expect(fetchSubscription).toHaveBeenCalledWith("sub_abc123");
    expect(mockSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "sub_abc123", status: "active", notes: NOTES }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization_id: "org-1", target_id: "sub_abc123", action: "billing_subscription_changed" }),
    );
    expect(mockRecordProcessed).toHaveBeenCalledWith(expect.anything(), "razorpay", "evt_1", "subscription.activated");
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before touching the database or Razorpay", async () => {
    const body = webhookBody("subscription.activated");
    const response = await POST(webhookRequest(body, { signature: sign(body, "wrong_secret") }));

    expect(response.status).toBe(400);
    expect(mockHasProcessed).not.toHaveBeenCalled();
    expect(fetchSubscription).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockRecordProcessed).not.toHaveBeenCalled();
  });

  it("rejects a request with no signature/event id, or when the webhook secret isn't configured", async () => {
    const body = webhookBody("subscription.activated");
    const noHeaders = new Request("http://localhost/api/webhooks/razorpay", { method: "POST", body });
    expect((await POST(noHeaders)).status).toBe(400);

    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    expect((await POST(webhookRequest(body))).status).toBe(400);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("acknowledges an already-processed event id without re-fetching or re-syncing", async () => {
    mockHasProcessed.mockResolvedValue(true);

    const response = await POST(webhookRequest(webhookBody("subscription.charged")));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(fetchSubscription).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("makes a replayed signed body under a new event id harmless: the payload's stale state is ignored and the provider's current state is written", async () => {
    // An old, genuinely-signed subscription.activated body (status active),
    // replayed after the subscription was cancelled. The event-id header
    // isn't covered by the signature, so dedup alone can't stop this.
    const oldBody = webhookBody("subscription.activated", providerSubscription({ status: "active" }));
    fetchSubscription.mockResolvedValue(providerSubscription({ status: "cancelled" }));

    const response = await POST(webhookRequest(oldBody, { eventId: "evt_forged_new_id" }));

    expect(response.status).toBe(200);
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync.mock.calls[0][1]).toMatchObject({ id: "sub_abc123", status: "cancelled" });
  });

  it("writes the fetched state for an out-of-order delivery (a late subscription.charged after cancellation)", async () => {
    fetchSubscription.mockResolvedValue(providerSubscription({ status: "cancelled" }));

    await POST(webhookRequest(webhookBody("subscription.charged", providerSubscription({ status: "active" }))));

    expect(mockSync.mock.calls[0][1]).toMatchObject({ status: "cancelled" });
  });

  it("returns 500 (so Razorpay retries), alerts, and records nothing when the provider re-fetch fails", async () => {
    fetchSubscription.mockRejectedValue({ statusCode: 502, error: { description: "Bad gateway" } });

    const response = await POST(webhookRequest(webhookBody("subscription.activated")));

    expect(response.status).toBe(500);
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockRecordProcessed).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({ job: "razorpay-webhook", message: expect.stringContaining("re-fetch") }),
    );
  });

  it("returns 500 and alerts when Razorpay returns a different subscription than requested", async () => {
    fetchSubscription.mockResolvedValue(providerSubscription({ id: "sub_someone_else" }));

    const response = await POST(webhookRequest(webhookBody("subscription.activated")));

    expect(response.status).toBe(500);
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
  });

  it("alerts but does not retry when an old live subscription would overwrite the organization's current one", async () => {
    mockSync.mockResolvedValue({
      outcome: "skipped_other_current_subscription",
      organizationId: "org-1",
      currentSubscriptionId: "sub_current",
      incomingNonTerminal: true,
    });

    const response = await POST(webhookRequest(webhookBody("subscription.activated")));

    expect(response.status).toBe(200);
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRecordProcessed).toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("different live subscription"),
        context: expect.objectContaining({ organizationId: "org-1", currentSubscriptionId: "sub_current", subscriptionId: "sub_abc123" }),
      }),
    );
  });

  it("ignores (without alerting) a late event for an old subscription that has already ended", async () => {
    mockSync.mockResolvedValue({
      outcome: "skipped_other_current_subscription",
      organizationId: "org-1",
      currentSubscriptionId: "sub_current",
      incomingNonTerminal: false,
    });

    const response = await POST(webhookRequest(webhookBody("subscription.cancelled")));

    expect(response.status).toBe(200);
    expect(mockCaptureError).not.toHaveBeenCalled();
    expect(mockRecordProcessed).toHaveBeenCalled();
  });

  it("alerts and acknowledges when the subscription's notes don't identify an organization", async () => {
    mockSync.mockResolvedValue({ outcome: "unmapped" });

    const response = await POST(webhookRequest(webhookBody("subscription.activated")));

    expect(response.status).toBe(200);
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRecordProcessed).toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("don't identify") }));
  });

  it("alerts on an unrecognized provider status (stored fail-closed) while still syncing it", async () => {
    fetchSubscription.mockResolvedValue(providerSubscription({ status: "some_future_status" }));
    mockSync.mockResolvedValue({ outcome: "synced", organizationId: "org-1", unrecognizedStatus: true });

    const response = await POST(webhookRequest(webhookBody("subscription.charged")));

    expect(response.status).toBe(200);
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("unrecognized"),
        context: expect.objectContaining({ razorpayStatus: "some_future_status" }),
      }),
    );
  });

  it("returns 500 (so Razorpay retries), alerts, and records nothing when the database sync fails", async () => {
    mockSync.mockRejectedValue(new Error("connection reset"));

    const response = await POST(webhookRequest(webhookBody("subscription.charged")));

    expect(response.status).toBe(500);
    expect(mockRecordProcessed).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("sync failed") }));
  });

  it("acknowledges and records an event type it doesn't handle, without re-fetching", async () => {
    const response = await POST(webhookRequest(webhookBody("subscription.authenticated")));

    expect(response.status).toBe(200);
    expect(fetchSubscription).not.toHaveBeenCalled();
    expect(mockRecordProcessed).toHaveBeenCalledWith(expect.anything(), "razorpay", "evt_1", "subscription.authenticated");
  });

  it.each(["null", "42", '"text"', "[]", '{"payload":{}}'])(
    "returns a controlled 400 (and alerts) for a correctly signed body that isn't an event object: %s",
    async (body) => {
      const response = await POST(webhookRequest(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Malformed payload." });
      expect(fetchSubscription).not.toHaveBeenCalled();
      expect(mockSync).not.toHaveBeenCalled();
      expect(mockRecordProcessed).not.toHaveBeenCalled();
      expect(mockCaptureError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("not a Razorpay event object") }));
    },
  );

  it("alerts and returns 400 for a handled event with no subscription id", async () => {
    const body = JSON.stringify({ event: "subscription.activated", payload: {} });

    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(400);
    expect(fetchSubscription).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
  });

  it("never puts the webhook secret or signature into an alert", async () => {
    fetchSubscription.mockRejectedValue(new Error("boom"));
    const body = webhookBody("subscription.activated");
    const signature = sign(body);

    await POST(webhookRequest(body, { signature }));

    const alerted = JSON.stringify(mockCaptureError.mock.calls);
    expect(alerted).not.toContain(SECRET);
    expect(alerted).not.toContain(signature);
  });
});
