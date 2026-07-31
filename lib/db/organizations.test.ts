import { describe, expect, it, vi } from "vitest";
import type { Client } from "./shared";
import {
  addOrganizationMember,
  createOrganization,
  getOrCreateOrganizationForUser,
  getOrganization,
  getOrganizationMembership,
} from "./organizations";

// Same fake-Client pattern as lib/db/suppressions.test.ts.
function createMockClient(result: { data?: unknown; error?: unknown }) {
  const chainable = {
    select: vi.fn(),
    insert: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: typeof result) => void) => resolve(result),
  };
  for (const method of ["select", "insert", "eq", "single", "maybeSingle"] as const) {
    chainable[method].mockReturnValue(chainable);
  }

  const from = vi.fn(() => chainable);
  const client = { from } as unknown as Client;
  return { client, chainable };
}

describe("getOrganizationMembership", () => {
  it("returns the row when the user belongs to an organization", async () => {
    const row = { id: "m-1", organization_id: "org-1", user_id: "user-1" };
    const { client, chainable } = createMockClient({ data: row, error: null });

    const result = await getOrganizationMembership(client, "user-1");

    expect(result).toBe(row);
    expect(client.from).toHaveBeenCalledWith("organization_members");
    expect(chainable.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null instead of throwing when the user has no membership yet", async () => {
    const { client } = createMockClient({ data: null, error: null });
    expect(await getOrganizationMembership(client, "user-1")).toBeNull();
  });

  it("throws when the query errors", async () => {
    const { client } = createMockClient({ data: null, error: new Error("connection lost") });
    await expect(getOrganizationMembership(client, "user-1")).rejects.toThrow("connection lost");
  });
});

describe("getOrganization", () => {
  it("returns the row on success", async () => {
    const row = { id: "org-1", name: "Acme" };
    const { client } = createMockClient({ data: row, error: null });
    expect(await getOrganization(client, "org-1")).toBe(row);
  });

  it("throws when the organization doesn't exist", async () => {
    const { client } = createMockClient({ data: null, error: null });
    await expect(getOrganization(client, "missing")).rejects.toThrow("Expected a row, received none.");
  });
});

describe("createOrganization", () => {
  it("inserts the given values", async () => {
    const { client, chainable } = createMockClient({ data: { id: "org-1" }, error: null });

    await createOrganization(client, { owner_user_id: "user-1", name: "Acme" });

    expect(client.from).toHaveBeenCalledWith("organizations");
    expect(chainable.insert).toHaveBeenCalledWith({ owner_user_id: "user-1", name: "Acme" });
  });
});

describe("addOrganizationMember", () => {
  it("inserts the given values", async () => {
    const { client, chainable } = createMockClient({ data: { id: "m-1" }, error: null });

    await addOrganizationMember(client, { organization_id: "org-1", user_id: "user-1" });

    expect(client.from).toHaveBeenCalledWith("organization_members");
    expect(chainable.insert).toHaveBeenCalledWith({ organization_id: "org-1", user_id: "user-1" });
  });
});

// Richer per-table mock (same pattern as lib/email/unsubscribe.test.ts) since
// getOrCreateOrganizationForUser touches both organization_members and
// organizations. Each table's results are a queue: the first call against
// that table resolves the first entry, the second call the second entry,
// and so on — needed here because organization_members is hit twice in the
// "no membership yet" branch (the lookup, then the insert), and each needs
// a different canned response.
function createMultiTableMockClient(tableResults: Record<string, { data?: unknown; error?: unknown }[]>) {
  const chainablesByTable: Record<string, ReturnType<typeof createChainable>> = {};

  function createChainable(results: { data?: unknown; error?: unknown }[]) {
    const queue = [...results];
    const chainable = {
      select: vi.fn(),
      insert: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(),
      maybeSingle: vi.fn(),
      then: (resolve: (value: { data?: unknown; error?: unknown }) => void) =>
        resolve(queue.length > 1 ? queue.shift()! : queue[0]),
    };
    for (const method of ["select", "insert", "eq", "single", "maybeSingle"] as const) {
      chainable[method].mockReturnValue(chainable);
    }
    return chainable;
  }

  const from = vi.fn((table: string) => {
    if (!chainablesByTable[table]) {
      chainablesByTable[table] = createChainable(tableResults[table] ?? [{ data: null, error: null }]);
    }
    return chainablesByTable[table];
  });

  const client = { from } as unknown as Client;
  return { client, chainablesByTable };
}

describe("getOrCreateOrganizationForUser", () => {
  it("returns the existing organization without creating a new one when a membership already exists", async () => {
    const membershipRow = { id: "m-1", organization_id: "org-1", user_id: "user-1" };
    const organizationRow = { id: "org-1", name: "Acme" };
    const { client, chainablesByTable } = createMultiTableMockClient({
      organization_members: [{ data: membershipRow, error: null }],
      organizations: [{ data: organizationRow, error: null }],
    });

    const result = await getOrCreateOrganizationForUser(client, "user-1", "user-1's workspace");

    expect(result).toBe(organizationRow);
    expect(chainablesByTable.organizations.eq).toHaveBeenCalledWith("id", "org-1");
    expect(chainablesByTable.organizations.insert).not.toHaveBeenCalled();
  });

  it("creates an organization and an owner membership when the user has none yet", async () => {
    const newOrganization = { id: "org-2", name: "New workspace" };
    const newMembership = { id: "m-2", organization_id: "org-2", user_id: "user-2" };
    const { client, chainablesByTable } = createMultiTableMockClient({
      // First call: the lookup (no membership yet). Second call: the insert.
      organization_members: [{ data: null, error: null }, { data: newMembership, error: null }],
      organizations: [{ data: newOrganization, error: null }],
    });

    const result = await getOrCreateOrganizationForUser(client, "user-2", "New workspace");

    expect(result).toBe(newOrganization);
    expect(chainablesByTable.organizations.insert).toHaveBeenCalledWith({
      owner_user_id: "user-2",
      name: "New workspace",
    });
    expect(chainablesByTable.organization_members.insert).toHaveBeenCalledWith({
      organization_id: "org-2",
      user_id: "user-2",
    });
  });
});
