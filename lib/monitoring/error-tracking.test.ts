import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureError, formatErrorSummary } from "./error-tracking";

const ENV_VAR = "ERROR_TRACKING_WEBHOOK_URL";

describe("captureError", () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env[ENV_VAR];
  });

  it("does nothing when no webhook URL is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await captureError({ job: "send-emails", message: "boom" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the input as JSON with an occurredAt timestamp when configured", async () => {
    process.env[ENV_VAR] = "https://example.com/hook";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await captureError({ job: "send-emails", message: "boom", context: { campaignLeadId: "cl-1" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" } }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ job: "send-emails", message: "boom", context: { campaignLeadId: "cl-1" } });
    expect(typeof body.occurredAt).toBe("string");
  });

  it("includes a readable summary as Slack's `text` and Discord's `content`, with the job, message and context", async () => {
    process.env[ENV_VAR] = "https://hooks.slack.com/services/T/B/X";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await captureError({ job: "send-emails", message: "Degraded run", context: { claimed: 4, needsReview: 1, campaignLeadId: "cl-1" } });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const expected = "[send-emails] Degraded run (claimed=4 needsReview=1 campaignLeadId=cl-1)";
    expect(body.text).toBe(expected);
    expect(body.content).toBe(expected);
  });

  it("does not log anything extra when the webhook accepts the payload", async () => {
    process.env[ENV_VAR] = "https://example.com/hook";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await captureError({ job: "send-emails", message: "boom" });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs a non-2xx webhook response without throwing", async () => {
    process.env[ENV_VAR] = "https://example.com/hook";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no_text", { status: 400 })));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(captureError({ job: "send-emails", message: "boom" })).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("[error-tracking]", "webhook rejected the forwarded error", { status: 400 });
  });

  it("never throws when the webhook itself is unreachable", async () => {
    process.env[ENV_VAR] = "https://example.com/hook";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(captureError({ job: "send-emails", message: "boom" })).resolves.toBeUndefined();
  });

  it("never throws when the request times out (aborted)", async () => {
    process.env[ENV_VAR] = "https://example.com/hook";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("This operation was aborted", "AbortError")));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(captureError({ job: "sync-replies", message: "boom" })).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("[error-tracking]", "failed to forward error", "This operation was aborted");
  });
});

describe("formatErrorSummary", () => {
  it("omits the context part when there is none", () => {
    expect(formatErrorSummary({ job: "sync-replies", message: "IMAP login failed" })).toBe("[sync-replies] IMAP login failed");
  });

  it("caps the summary under Discord's 2000-character content limit", () => {
    const summary = formatErrorSummary({ job: "send-emails", message: "x".repeat(3000) });
    expect(summary.length).toBeLessThanOrEqual(1900);
    expect(summary.endsWith("…")).toBe(true);
  });
});
