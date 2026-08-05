import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pingHeartbeat } from "./heartbeat";

const ENV_VAR = "CRON_HEARTBEAT_URL_SEND_EMAILS";

describe("pingHeartbeat", () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env[ENV_VAR];
  });

  it("does nothing when the job's env var is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await pingHeartbeat("send-emails", "success");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GETs the bare URL on success", async () => {
    process.env[ENV_VAR] = "https://hc-ping.com/abc123";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await pingHeartbeat("send-emails", "success");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hc-ping.com/abc123",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("GETs '<url>/fail' on failure", async () => {
    process.env[ENV_VAR] = "https://hc-ping.com/abc123";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await pingHeartbeat("send-emails", "fail");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hc-ping.com/abc123/fail",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("strips a trailing slash before appending /fail", async () => {
    process.env[ENV_VAR] = "https://hc-ping.com/abc123/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await pingHeartbeat("send-emails", "fail");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hc-ping.com/abc123/fail",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("never throws when the ping itself fails", async () => {
    process.env[ENV_VAR] = "https://hc-ping.com/abc123";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(pingHeartbeat("send-emails", "success")).resolves.toBeUndefined();
  });
});
