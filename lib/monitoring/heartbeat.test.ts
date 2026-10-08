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
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(pingHeartbeat("send-emails", "success")).resolves.toBeUndefined();
    consoleError.mockRestore();
  });
});

describe("pingHeartbeat logging", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env[ENV_VAR];
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleError.mockRestore();
    delete process.env[ENV_VAR];
  });

  it("stays silent when the job's env var is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(pingHeartbeat("send-emails", "success")).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("stays silent on a successful ping", async () => {
    process.env[ENV_VAR] = "https://hc-ping.com/abc123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(pingHeartbeat("send-emails", "success")).resolves.toBeUndefined();

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("logs, without throwing, when the ping request throws", async () => {
    process.env[ENV_VAR] = "https://hc-ping.com/abc123";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(pingHeartbeat("send-emails", "fail")).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("[heartbeat]", "ping failed", {
      job: "send-emails",
      outcome: "fail",
      envVar: ENV_VAR,
      error: "network down",
    });
  });

  it("logs, without throwing, when the provider answers with a non-2xx status", async () => {
    process.env[ENV_VAR] = "https://hc-ping.com/wrong-uuid";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));

    await expect(pingHeartbeat("send-emails", "success")).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith("[heartbeat]", "ping was rejected", {
      job: "send-emails",
      outcome: "success",
      envVar: ENV_VAR,
      status: 404,
    });
  });

  it("never logs the ping URL, which carries the check's secret key", async () => {
    process.env[ENV_VAR] = "https://hc-ping.com/secret-ping-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await pingHeartbeat("send-emails", "fail");

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-ping-key");
  });
});
