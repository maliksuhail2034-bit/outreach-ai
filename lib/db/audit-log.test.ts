import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import { recordAuditEvent } from "./audit-log";

// Same fake-Client pattern as lib/db/integrations.test.ts / job-runs.test.ts.
function createMockClient(result: { error?: unknown }) {
  const chainable = {
    insert: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  chainable.insert.mockReturnValue(chainable);

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

const BASE_VALUES = {
  organization_id: "org-1",
  actor_user_id: "user-1",
  action: "mailbox_connected" as const,
  target_type: "mailbox" as const,
  target_id: "mailbox-1",
  metadata: { email: "user@example.com", provider: "smtp" },
};

describe("recordAuditEvent", () => {
  it("inserts the given row into audit_logs", async () => {
    const { client, chainable } = createMockClient({ error: null });

    await recordAuditEvent(client, BASE_VALUES);

    expect(client.from).toHaveBeenCalledWith("audit_logs");
    expect(chainable.insert).toHaveBeenCalledWith(BASE_VALUES);
  });

  it("never throws when the insert fails — logs to console instead", async () => {
    const { client } = createMockClient({ error: new Error("insert failed") });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordAuditEvent(client, BASE_VALUES)).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[audit-log] failed to record event",
      "mailbox_connected",
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it("accepts a null actor_user_id for system-initiated events (e.g. the Stripe webhook)", async () => {
    const { client, chainable } = createMockClient({ error: null });
    const values = { ...BASE_VALUES, actor_user_id: null, action: "billing_subscription_changed" as const };

    await recordAuditEvent(client, values);

    expect(chainable.insert).toHaveBeenCalledWith(values);
  });
});
