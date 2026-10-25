import { describe, expect, it } from "vitest";
import type { Client } from "@/lib/db/shared";
import {
  applyRemovalPlan,
  normalizeRemovalEmail,
  parseRemovalRequestInput,
  planRemovalRequest,
  removalPlanDigest,
} from "./removal-request";

// A small in-memory stand-in for the four tables involved, evaluating the
// eq/in filters the module uses, so planning and applying run against real
// rows instead of canned responses. suppressions enforces the real
// unique (user_id, email) constraint.
type Row = Record<string, unknown>;

function createFakeDb(tables: Record<string, Row[]>, options: { failInsert?: boolean; dropInsert?: boolean } = {}) {
  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: ((row: Row) => boolean)[] = [];
    let operation: { kind: "select" } | { kind: "update"; values: Row } | { kind: "insert"; values: Row } = { kind: "select" };

    const run = () => {
      if (operation.kind === "insert") {
        if (options.failInsert) return { data: null, error: { code: "57014", message: "boom" } };
        const values = operation.values;
        if (table === "suppressions" && rows.some((row) => row.user_id === values.user_id && row.email === values.email)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        if (!options.dropInsert) rows.push({ id: `${table}-${rows.length + 1}`, ...values });
        return { data: null, error: null };
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (operation.kind === "update") {
        for (const row of matched) Object.assign(row, operation.values);
      }
      return { data: matched.map((row) => ({ ...row })), error: null };
    };

    const builder = {
      select: () => builder,
      range: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      update: (values: Row) => {
        operation = { kind: "update", values };
        return builder;
      },
      insert: (values: Row) => {
        operation = { kind: "insert", values };
        return builder;
      },
      then: (resolve: (value: ReturnType<typeof run>) => void) => resolve(run()),
    };
    return builder;
  }
  return { client: { from } as unknown as Client, tables };
}

const PROJECT = "https://project.supabase.co";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function seed() {
  return {
    leads: [
      { id: "lead-a", user_id: OWNER_A, email: "person@example.com" },
      { id: "lead-b", user_id: OWNER_B, email: "person@example.com" },
      { id: "lead-other", user_id: OWNER_A, email: "someone-else@example.com" },
    ],
    mailboxes: [
      { user_id: OWNER_A, email: "Sales@CustomerA.example" },
      { user_id: OWNER_C, email: "outreach@customer-c.example" },
    ],
    suppressions: [] as Row[],
    campaign_leads: [
      { id: "cl-a-active", lead_id: "lead-a", status: "active", next_send_at: "2026-11-01T00:00:00Z", locked_until: null },
      { id: "cl-a-pending", lead_id: "lead-a", status: "pending", next_send_at: null, locked_until: null },
      { id: "cl-a-done", lead_id: "lead-a", status: "completed", next_send_at: null, locked_until: null },
      { id: "cl-b-active", lead_id: "lead-b", status: "active", next_send_at: "2026-11-01T00:00:00Z", locked_until: null },
      { id: "cl-other", lead_id: "lead-other", status: "active", next_send_at: "2026-11-01T00:00:00Z", locked_until: null },
    ],
  };
}

const request = (overrides: Partial<Parameters<typeof planRemovalRequest>[2]> = {}) => ({
  email: "person@example.com",
  requestRef: "support 2026-10-26 <msg-1>",
  senderMailboxes: [],
  ownerIds: [],
  ...overrides,
});

describe("normalizeRemovalEmail / parseRemovalRequestInput", () => {
  it("trims and lowercases, the way lead addresses are stored", () => {
    expect(normalizeRemovalEmail("  Person@Example.COM ")).toBe("person@example.com");
  });

  it("rejects anything that isn't an address", () => {
    expect(normalizeRemovalEmail("")).toBeNull();
    expect(normalizeRemovalEmail("person")).toBeNull();
    expect(normalizeRemovalEmail("a b@example.com")).toBeNull();
    expect(normalizeRemovalEmail(`${"a".repeat(320)}@example.com`)).toBeNull();
  });

  it("requires a request reference and valid owner ids", () => {
    expect(() => parseRemovalRequestInput(request({ requestRef: "  " }))).toThrow(/request-ref/);
    expect(() => parseRemovalRequestInput(request({ ownerIds: ["not-a-uuid"] }))).toThrow(/owner/);
    expect(() => parseRemovalRequestInput(request({ senderMailboxes: ["nope"] }))).toThrow(/sender-mailbox/);
  });
});

describe("planRemovalRequest", () => {
  it("targets every account holding the address as a lead, with only their open enrollments", async () => {
    const { client } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request({ email: " PERSON@example.com" }));

    expect(plan.email).toBe("person@example.com");
    expect(plan.targets.map((target) => target.userId).sort()).toEqual([OWNER_A, OWNER_B]);
    const a = plan.targets.find((target) => target.userId === OWNER_A);
    expect(a?.openEnrollmentIds.sort()).toEqual(["cl-a-active", "cl-a-pending"]);
    expect(a?.existingSuppression).toBeNull();
    expect(plan.targets.flatMap((target) => target.openEnrollmentIds)).not.toContain("cl-other");
  });

  it("adds the account owning the sender mailbox (matched case-insensitively), even with no lead", async () => {
    const { client } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request({ senderMailboxes: ["outreach@CUSTOMER-C.example", "sales@customera.example"] }));

    const c = plan.targets.find((target) => target.userId === OWNER_C);
    expect(c).toMatchObject({ leadIds: [], senderMailboxes: ["outreach@customer-c.example"], openEnrollmentIds: [] });
    expect(plan.targets.find((target) => target.userId === OWNER_A)?.senderMailboxes).toEqual(["sales@customera.example"]);
  });

  it("limits the targets to an explicit owner list and reports the other matches", async () => {
    const { client } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request({ ownerIds: [OWNER_B] }));

    expect(plan.targets.map((target) => target.userId)).toEqual([OWNER_B]);
    expect(plan.excludedCandidates).toEqual([OWNER_A]);
  });

  it("has no targets for an unknown address with no sender mailbox", async () => {
    const { client } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request({ email: "nobody@example.com" }));
    expect(plan.targets).toEqual([]);
  });

  it("reports an existing suppression instead of planning a new one", async () => {
    const tables = seed();
    tables.suppressions.push({ user_id: OWNER_A, email: "person@example.com", reason: "unsubscribed" });
    const { client } = createFakeDb(tables);
    const plan = await planRemovalRequest(client, PROJECT, request());
    expect(plan.targets.find((target) => target.userId === OWNER_A)?.existingSuppression).toBe("unsubscribed");
  });
});

describe("removalPlanDigest", () => {
  it("changes when the project, the targets, an existing suppression or the enrollments to stop change", async () => {
    const { client } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request());
    const digest = removalPlanDigest(plan);

    expect(plan.digest).toBe(digest);
    expect(removalPlanDigest({ ...plan, projectUrl: "https://staging.supabase.co" })).not.toBe(digest);
    expect(removalPlanDigest({ ...plan, targets: plan.targets.slice(1) })).not.toBe(digest);
    expect(
      removalPlanDigest({ ...plan, targets: plan.targets.map((target) => ({ ...target, existingSuppression: "manual" })) }),
    ).not.toBe(digest);
    expect(
      removalPlanDigest({ ...plan, targets: plan.targets.map((target) => ({ ...target, openEnrollmentIds: [] })) }),
    ).not.toBe(digest);
  });

  it("doesn't depend on the order targets or enrollments were read in", async () => {
    const { client } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request());
    const reordered = [...plan.targets].reverse().map((target) => ({ ...target, openEnrollmentIds: [...target.openEnrollmentIds].reverse() }));
    expect(removalPlanDigest({ ...plan, targets: reordered })).toBe(plan.digest);
  });
});

describe("applyRemovalPlan", () => {
  it("writes a manual suppression per account and stops only that address's open enrollments", async () => {
    const { client, tables } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request());

    const results = await applyRemovalPlan(client, plan);

    expect(tables.suppressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: OWNER_A, email: "person@example.com", reason: "manual" }),
        expect.objectContaining({ user_id: OWNER_B, email: "person@example.com", reason: "manual" }),
      ]),
    );
    expect(tables.suppressions).toHaveLength(2);
    const status = (id: string) => tables.campaign_leads.find((row) => row.id === id);
    expect(status("cl-a-active")).toMatchObject({ status: "unsubscribed", next_send_at: null, locked_until: null });
    expect(status("cl-a-pending")).toMatchObject({ status: "unsubscribed" });
    expect(status("cl-b-active")).toMatchObject({ status: "unsubscribed" });
    expect(status("cl-a-done")).toMatchObject({ status: "completed" });
    expect(status("cl-other")).toMatchObject({ status: "active" });
    expect(results).toEqual(
      expect.arrayContaining([
        { userId: OWNER_A, suppression: "created", reason: "manual", stoppedEnrollments: 2 },
        { userId: OWNER_B, suppression: "created", reason: "manual", stoppedEnrollments: 1 },
      ]),
    );
  });

  it("is safe to repeat: a second apply writes no duplicate and stops nothing more", async () => {
    const { client, tables } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request());
    await applyRemovalPlan(client, plan);

    const results = await applyRemovalPlan(client, plan);

    expect(tables.suppressions).toHaveLength(2);
    expect(results.every((result) => result.suppression === "already_suppressed" && result.stoppedEnrollments === 0)).toBe(true);
  });

  it("keeps an existing suppression's reason rather than overwriting it", async () => {
    const tables = seed();
    tables.suppressions.push({ user_id: OWNER_A, email: "person@example.com", reason: "bounced" });
    const { client } = createFakeDb(tables);
    const plan = await planRemovalRequest(client, PROJECT, request({ ownerIds: [OWNER_A] }));

    const [result] = await applyRemovalPlan(client, plan);

    expect(result).toMatchObject({ suppression: "already_suppressed", reason: "bounced" });
    expect(tables.suppressions).toHaveLength(1);
  });

  it("leaves an enrollment that finished after the dry run with its real outcome", async () => {
    const { client, tables } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request());
    const row = tables.campaign_leads.find((enrollment) => enrollment.id === "cl-b-active");
    if (row) row.status = "replied";

    await applyRemovalPlan(client, plan);

    expect(row?.status).toBe("replied");
  });

  it("refuses a plan with no accounts", async () => {
    const { client } = createFakeDb(seed());
    const plan = await planRemovalRequest(client, PROJECT, request({ email: "nobody@example.com" }));
    await expect(applyRemovalPlan(client, plan)).rejects.toThrow(/no accounts/);
  });

  it("throws when a suppression reported as written can't be read back", async () => {
    const { client } = createFakeDb(seed(), { dropInsert: true });
    const plan = await planRemovalRequest(client, PROJECT, request());
    await expect(applyRemovalPlan(client, plan)).rejects.toThrow(/not found after writing/);
  });

  it("throws, stopping no enrollment, when a suppression can't be written", async () => {
    const tables = seed();
    const { client } = createFakeDb(tables, { failInsert: true });
    const plan = await planRemovalRequest(client, PROJECT, request());

    await expect(applyRemovalPlan(client, plan)).rejects.toMatchObject({ code: "57014" });
    expect(tables.campaign_leads.find((row) => row.id === "cl-a-active")?.status).toBe("active");
  });
});
