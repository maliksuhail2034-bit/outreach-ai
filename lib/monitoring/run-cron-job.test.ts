import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordJobRunMock, pingHeartbeatMock, captureErrorMock } = vi.hoisted(() => ({
  recordJobRunMock: vi.fn(),
  pingHeartbeatMock: vi.fn(),
  captureErrorMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/lib/db", () => ({
  recordJobRun: recordJobRunMock,
}));

vi.mock("./heartbeat", () => ({
  pingHeartbeat: pingHeartbeatMock,
}));

vi.mock("./error-tracking", () => ({
  captureError: captureErrorMock,
}));

import { runCronJob } from "./run-cron-job";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/cron/send-emails", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  recordJobRunMock.mockResolvedValue(undefined);
  pingHeartbeatMock.mockResolvedValue(undefined);
  captureErrorMock.mockResolvedValue(undefined);
  process.env.CRON_SECRET = "test-secret";
});

describe("runCronJob", () => {
  it("returns 401 without ever running the job when the bearer token is missing", async () => {
    const run = vi.fn();

    const response = await runCronJob(makeRequest(), "send-emails", run);

    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    expect(recordJobRunMock).not.toHaveBeenCalled();
    expect(pingHeartbeatMock).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is unset, even with a bearer token present", async () => {
    delete process.env.CRON_SECRET;
    const run = vi.fn();

    const response = await runCronJob(makeRequest({ authorization: "Bearer anything" }), "send-emails", run);

    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("on success: runs the job, persists a success job_runs row, and pings the heartbeat", async () => {
    const run = vi.fn().mockResolvedValue({ claimed: 2, sent: 2, failed: 0, needsReview: 0, skipped: 0 });

    const response = await runCronJob(
      makeRequest({ authorization: "Bearer test-secret" }),
      "send-emails",
      run,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ claimed: 2, sent: 2 });
    expect(typeof body.executionTimeMs).toBe("number");

    expect(recordJobRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ job: "send-emails", status: "success", error: null }),
    );
    expect(pingHeartbeatMock).toHaveBeenCalledWith("send-emails", "success");
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("on failure: returns 500, persists an error job_runs row, pings the fail heartbeat, and forwards to error tracking", async () => {
    const run = vi.fn().mockRejectedValue(new Error("worker blew up"));

    const response = await runCronJob(
      makeRequest({ authorization: "Bearer test-secret" }),
      "send-emails",
      run,
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("worker blew up");

    expect(recordJobRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ job: "send-emails", status: "error", error: "worker blew up" }),
    );
    expect(pingHeartbeatMock).toHaveBeenCalledWith("send-emails", "fail");
    expect(captureErrorMock).toHaveBeenCalledWith({ job: "send-emails", message: "worker blew up" });
  });

  it("still returns the job's result even if persisting the job_runs row fails", async () => {
    recordJobRunMock.mockRejectedValue(new Error("db unavailable"));
    const run = vi.fn().mockResolvedValue({ checked: 1, updated: 1, failed: 0 });

    const response = await runCronJob(
      makeRequest({ authorization: "Bearer test-secret" }),
      "deliverability-health-check",
      run,
    );

    expect(response.status).toBe(200);
    expect(pingHeartbeatMock).toHaveBeenCalledWith("deliverability-health-check", "success");
  });
});
