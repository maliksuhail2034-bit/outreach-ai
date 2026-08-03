import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import {
  deleteIntegration,
  getIntegration,
  getIntegrationByProvider,
  listEnabledIntegrations,
  listIntegrations,
  recordIntegrationDeliveryResult,
  updateIntegration,
  upsertIntegration,
} from "./integrations";

// Same fake-Client pattern as lib/db/deliverability.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "insert", "upsert", "update", "delete", "eq", "order", "single", "maybeSingle"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("listIntegrations", () => {
  it("scopes to the organization and orders newest-first", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listIntegrations(client, "org-1");

    expect(client.from).toHaveBeenCalledWith("integrations");
    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("returns an empty array instead of null when there are no rows", async () => {
    const { client } = createMockClient({ data: null, error: null });
    expect(await listIntegrations(client, "org-1")).toEqual([]);
  });
});

describe("getIntegration", () => {
  it("scopes the lookup to both organization and id", async () => {
    const { client, chainable } = createMockClient({ data: { id: "integration-1" }, error: null });

    await getIntegration(client, "org-1", "integration-1");

    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.eq).toHaveBeenCalledWith("id", "integration-1");
  });
});

describe("getIntegrationByProvider", () => {
  it("scopes the lookup to both organization and provider", async () => {
    const { client, chainable } = createMockClient({ data: null, error: null });

    await getIntegrationByProvider(client, "org-1", "webhook");

    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.eq).toHaveBeenCalledWith("provider", "webhook");
  });
});

describe("upsertIntegration", () => {
  it("upserts on (organization_id, provider) so reconnecting replaces the prior row", async () => {
    const { client, chainable } = createMockClient({ data: { id: "integration-1" }, error: null });

    await upsertIntegration(client, {
      organization_id: "org-1",
      provider: "webhook",
      status: "enabled",
      config: { url: "https://example.com/hook" },
    });

    expect(chainable.upsert).toHaveBeenCalledWith(
      { organization_id: "org-1", provider: "webhook", status: "enabled", config: { url: "https://example.com/hook" } },
      { onConflict: "organization_id,provider" },
    );
  });
});

describe("updateIntegration", () => {
  it("scopes the update to both organization and id", async () => {
    const { client, chainable } = createMockClient({ data: { id: "integration-1" }, error: null });

    await updateIntegration(client, "org-1", "integration-1", { status: "disabled" });

    expect(chainable.update).toHaveBeenCalledWith({ status: "disabled" });
    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.eq).toHaveBeenCalledWith("id", "integration-1");
  });
});

describe("deleteIntegration", () => {
  it("scopes the delete to both organization and id", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await deleteIntegration(client, "org-1", "integration-1");

    expect(chainable.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(chainable.eq).toHaveBeenCalledWith("id", "integration-1");
  });
});

describe("listEnabledIntegrations", () => {
  it("scopes to status=enabled across every organization", async () => {
    const { client, chainable } = createMockClient({ data: [], error: null });

    await listEnabledIntegrations(client);

    expect(chainable.eq).toHaveBeenCalledWith("status", "enabled");
  });
});

describe("recordIntegrationDeliveryResult", () => {
  it("only ever touches the delivery-result columns", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await recordIntegrationDeliveryResult(client, "integration-1", { status: "failed", error: "timed out" });

    expect(chainable.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_status: "failed", last_error: "timed out" }),
    );
    expect(chainable.eq).toHaveBeenCalledWith("id", "integration-1");
  });
});
