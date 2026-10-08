import { beforeEach, describe, expect, it, vi } from "vitest";

const { runCronJobMock } = vi.hoisted(() => ({ runCronJobMock: vi.fn() }));

vi.mock("@/lib/monitoring/run-cron-job", () => ({ runCronJob: runCronJobMock }));

import { POST as deliverabilityHealthCheck } from "./deliverability-health-check/route";
import { POST as analyticsRollup } from "./analytics-rollup/route";
import { POST as integrationsDigest } from "./integrations-digest/route";
import { POST as retentionCleanup } from "./retention-cleanup/route";
import { deliverabilityHealthCheckDegraded } from "@/lib/deliverability/health-check-worker";
import { analyticsRollupDegraded } from "@/lib/analytics/rollup-worker";

function request(): Request {
  return new Request("https://example.com/api/cron/job", { method: "POST" });
}

beforeEach(() => {
  runCronJobMock.mockReset();
  runCronJobMock.mockResolvedValue(new Response(null, { status: 200 }));
});

// Which cron routes turn a partial failure into a degraded run (a failing
// heartbeat). The degraded check itself is tested next to each worker; this
// pins which routes pass one.
describe("degraded run wiring", () => {
  it("deliverability-health-check passes its degraded check", async () => {
    await deliverabilityHealthCheck(request());

    expect(runCronJobMock).toHaveBeenCalledWith(
      expect.any(Request),
      "deliverability-health-check",
      expect.any(Function),
      deliverabilityHealthCheckDegraded,
    );
  });

  it("analytics-rollup passes its degraded check", async () => {
    await analyticsRollup(request());

    expect(runCronJobMock).toHaveBeenCalledWith(
      expect.any(Request),
      "analytics-rollup",
      expect.any(Function),
      analyticsRollupDegraded,
    );
  });

  it("integrations-digest deliberately has none: a failed delivery is usually a customer's webhook, not our job", async () => {
    await integrationsDigest(request());

    expect(runCronJobMock).toHaveBeenCalledTimes(1);
    expect(runCronJobMock.mock.calls[0][1]).toBe("integrations-digest");
    expect(runCronJobMock.mock.calls[0][3]).toBeUndefined();
  });

  it("retention-cleanup has none: any failure already fails the whole run", async () => {
    await retentionCleanup(request());

    expect(runCronJobMock.mock.calls[0][1]).toBe("retention-cleanup");
    expect(runCronJobMock.mock.calls[0][3]).toBeUndefined();
  });
});
