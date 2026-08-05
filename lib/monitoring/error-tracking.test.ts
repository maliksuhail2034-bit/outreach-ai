import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureError } from "./error-tracking";

const ENV_VAR = "ERROR_TRACKING_WEBHOOK_URL";

describe("captureError", () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("never throws when the webhook itself is unreachable", async () => {
    process.env[ENV_VAR] = "https://example.com/hook";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(captureError({ job: "send-emails", message: "boom" })).resolves.toBeUndefined();
  });
});
