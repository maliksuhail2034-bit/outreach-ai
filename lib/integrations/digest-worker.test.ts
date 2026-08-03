import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  listEnabledIntegrationsMock,
  getOrganizationMock,
  recordIntegrationDeliveryResultMock,
  buildOrganizationDigestMock,
  getIntegrationProviderMock,
  sendMock,
} = vi.hoisted(() => ({
  listEnabledIntegrationsMock: vi.fn(),
  getOrganizationMock: vi.fn(),
  recordIntegrationDeliveryResultMock: vi.fn(),
  buildOrganizationDigestMock: vi.fn(),
  getIntegrationProviderMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/lib/db", () => ({
  getOrganization: getOrganizationMock,
  listEnabledIntegrations: listEnabledIntegrationsMock,
  recordIntegrationDeliveryResult: recordIntegrationDeliveryResultMock,
}));

vi.mock("./digest", () => ({
  buildOrganizationDigest: buildOrganizationDigestMock,
}));

vi.mock("./get-provider", () => ({
  getIntegrationProvider: getIntegrationProviderMock,
}));

import { runIntegrationsDigestWorker } from "./digest-worker";

const INTEGRATION_A = { id: "integration-a", organization_id: "org-a", provider: "webhook" };
const INTEGRATION_B = { id: "integration-b", organization_id: "org-b", provider: "webhook" };

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationMock.mockImplementation((_client: unknown, organizationId: string) =>
    Promise.resolve({ id: organizationId, name: "Org", owner_user_id: "user-1" }),
  );
  buildOrganizationDigestMock.mockResolvedValue({ organizationId: "org-a", insights: [] });
  getIntegrationProviderMock.mockReturnValue({ send: sendMock });
  sendMock.mockResolvedValue({ delivered: true });
  recordIntegrationDeliveryResultMock.mockResolvedValue(undefined);
});

describe("runIntegrationsDigestWorker", () => {
  it("delivers a digest to every enabled integration and reports the summary", async () => {
    listEnabledIntegrationsMock.mockResolvedValue([INTEGRATION_A, INTEGRATION_B]);

    const summary = await runIntegrationsDigestWorker();

    expect(summary).toEqual({ checked: 2, delivered: 2, failed: 0 });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(recordIntegrationDeliveryResultMock).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_A.id,
      { status: "success", error: null },
    );
  });

  it("isolates a single integration's delivery failure so the rest of the run still completes", async () => {
    listEnabledIntegrationsMock.mockResolvedValue([INTEGRATION_A, INTEGRATION_B]);
    sendMock.mockRejectedValueOnce(new Error("webhook unreachable")).mockResolvedValueOnce({ delivered: true });

    const summary = await runIntegrationsDigestWorker();

    expect(summary).toEqual({ checked: 2, delivered: 1, failed: 1 });
    expect(recordIntegrationDeliveryResultMock).toHaveBeenCalledWith(
      expect.anything(),
      INTEGRATION_A.id,
      { status: "failed", error: "webhook unreachable" },
    );
  });

  it("isolates a failure building the digest itself", async () => {
    listEnabledIntegrationsMock.mockResolvedValue([INTEGRATION_A, INTEGRATION_B]);
    buildOrganizationDigestMock.mockRejectedValueOnce(new Error("rollup failed")).mockResolvedValueOnce({
      organizationId: "org-b",
      insights: [],
    });

    const summary = await runIntegrationsDigestWorker();

    expect(summary).toEqual({ checked: 2, delivered: 1, failed: 1 });
  });

  it("does not let a failure recording the failure crash the run", async () => {
    listEnabledIntegrationsMock.mockResolvedValue([INTEGRATION_A]);
    sendMock.mockRejectedValueOnce(new Error("webhook unreachable"));
    recordIntegrationDeliveryResultMock.mockRejectedValueOnce(new Error("db unavailable"));

    const summary = await runIntegrationsDigestWorker();

    expect(summary).toEqual({ checked: 1, delivered: 0, failed: 1 });
  });

  it("returns a zeroed summary when there are no enabled integrations", async () => {
    listEnabledIntegrationsMock.mockResolvedValue([]);

    const summary = await runIntegrationsDigestWorker();

    expect(summary).toEqual({ checked: 0, delivered: 0, failed: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
