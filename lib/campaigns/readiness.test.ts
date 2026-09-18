import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_EXECUTION_STATE_LABEL,
  checkCampaignReadiness,
  deriveExecutionState,
  resolveLeadMailboxId,
  resolvePoolMailboxId,
} from "./readiness";

const ACTIVE_MAILBOX = {
  id: "mailbox-1",
  display_name: "Sales",
  email: "sales@example.com",
  status: "active",
  daily_limit: 50,
  hourly_limit: 10,
};

describe("resolveLeadMailboxId", () => {
  it("prefers the lead's own mailbox override", () => {
    expect(resolveLeadMailboxId({ mailbox_id: "mailbox-1" }, { default_mailbox_id: "mailbox-2" })).toBe("mailbox-1");
  });

  it("falls back to the campaign default when the lead has no override", () => {
    expect(resolveLeadMailboxId({ mailbox_id: null }, { default_mailbox_id: "mailbox-2" })).toBe("mailbox-2");
  });

  it("returns null when neither is set", () => {
    expect(resolveLeadMailboxId({ mailbox_id: null }, { default_mailbox_id: null })).toBeNull();
  });
});

// Batch 8: pure round-robin selection across a campaign's configured
// mailbox pool.
describe("resolvePoolMailboxId", () => {
  it("returns null for an empty pool", () => {
    expect(resolvePoolMailboxId([], 0)).toBeNull();
    expect(resolvePoolMailboxId([], 5)).toBeNull();
  });

  it("always returns the same mailbox for a single-mailbox pool", () => {
    const pool = [{ mailbox_id: "mailbox-1" }];
    expect(resolvePoolMailboxId(pool, 0)).toBe("mailbox-1");
    expect(resolvePoolMailboxId(pool, 1)).toBe("mailbox-1");
    expect(resolvePoolMailboxId(pool, 7)).toBe("mailbox-1");
  });

  it("cycles across a multi-mailbox pool in order", () => {
    const pool = [{ mailbox_id: "mailbox-1" }, { mailbox_id: "mailbox-2" }, { mailbox_id: "mailbox-3" }];
    expect(resolvePoolMailboxId(pool, 0)).toBe("mailbox-1");
    expect(resolvePoolMailboxId(pool, 1)).toBe("mailbox-2");
    expect(resolvePoolMailboxId(pool, 2)).toBe("mailbox-3");
  });

  it("wraps around past the pool length", () => {
    const pool = [{ mailbox_id: "mailbox-1" }, { mailbox_id: "mailbox-2" }, { mailbox_id: "mailbox-3" }];
    expect(resolvePoolMailboxId(pool, 3)).toBe("mailbox-1");
    expect(resolvePoolMailboxId(pool, 4)).toBe("mailbox-2");
    expect(resolvePoolMailboxId(pool, 7)).toBe("mailbox-2");
  });
});

describe("checkCampaignReadiness", () => {
  it("is ready when leads, a sequence, and resolvable active mailboxes all exist", () => {
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [ACTIVE_MAILBOX],
      domainCount: 1,
    });

    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("blocks with no leads enrolled", () => {
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [],
      sequenceStepCount: 1,
      mailboxes: [ACTIVE_MAILBOX],
      domainCount: 1,
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Enroll at least one lead before launching.");
  });

  it("blocks with no sequence steps", () => {
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 0,
      mailboxes: [ACTIVE_MAILBOX],
      domainCount: 1,
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toContain("Add at least one sequence step before launching.");
  });

  it("blocks when a lead has no resolvable mailbox", () => {
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: null },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [ACTIVE_MAILBOX],
      domainCount: 1,
    });

    expect(result.ready).toBe(false);
    expect(result.errors.some((error) => error.includes("no mailbox assigned"))).toBe(true);
  });

  it("blocks when the resolved mailbox isn't active", () => {
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [{ ...ACTIVE_MAILBOX, status: "paused" }],
      domainCount: 1,
    });

    expect(result.ready).toBe(false);
    expect(result.errors.some((error) => error.includes("aren't active"))).toBe(true);
  });

  // Batch 8: an inactive mailbox in the configured pool blocks readiness
  // independently of the per-lead check — even when every enrolled lead
  // already resolves to a different, active mailbox.
  it("blocks when a mailbox in the configured pool isn't active, even if every lead resolves elsewhere", () => {
    const poolMailbox = { ...ACTIVE_MAILBOX, id: "mailbox-2", status: "paused" };
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [ACTIVE_MAILBOX, poolMailbox],
      domainCount: 1,
      campaignMailboxes: [{ mailbox_id: "mailbox-2" }],
    });

    expect(result.ready).toBe(false);
    expect(result.errors.some((error) => error.includes("aren't active"))).toBe(true);
  });

  it("is ready when every pool mailbox is active", () => {
    const poolMailbox = { ...ACTIVE_MAILBOX, id: "mailbox-2" };
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [ACTIVE_MAILBOX, poolMailbox],
      domainCount: 1,
      campaignMailboxes: [{ mailbox_id: "mailbox-2" }],
    });

    expect(result.ready).toBe(true);
  });

  // Regression test for the pool-only readiness bug: a campaign configured
  // with ONLY a mailbox pool (no default_mailbox_id at all — a valid
  // configuration campaign-setup-wizard.tsx's deriveStep explicitly treats
  // as satisfying the "mailbox" step) must not be blocked just because its
  // leads (enrolled before the pool was configured, the wizard's normal
  // Leads-then-Mailbox order) still have mailbox_id: null. The pool resolves
  // them at launch-time backfill (see launchCampaignAction) even though
  // resolveLeadMailboxId alone — which never looks at the pool — can't see
  // that.
  it("is ready for a pool-only campaign: null default_mailbox_id, null lead mailbox_id, valid pool", () => {
    const poolMailbox = { ...ACTIVE_MAILBOX, id: "mailbox-2" };
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: null },
      campaignLeads: [{ mailbox_id: null }, { mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [poolMailbox],
      domainCount: 1,
      campaignMailboxes: [{ mailbox_id: "mailbox-2" }],
    });

    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("still blocks a pool-only campaign when the pool itself is inactive", () => {
    const poolMailbox = { ...ACTIVE_MAILBOX, id: "mailbox-2", status: "paused" };
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: null },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [poolMailbox],
      domainCount: 1,
      campaignMailboxes: [{ mailbox_id: "mailbox-2" }],
    });

    expect(result.ready).toBe(false);
    expect(result.errors.some((error) => error.includes("aren't active"))).toBe(true);
  });

  it("defaults to an empty pool — no campaignMailboxes field behaves exactly as before this field existed", () => {
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [ACTIVE_MAILBOX],
      domainCount: 1,
    });

    expect(result.ready).toBe(true);
  });

  it("warns (but doesn't block) when no sending domain is configured", () => {
    const result = checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes: [ACTIVE_MAILBOX],
      domainCount: 0,
    });

    expect(result.ready).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("sending domain"))).toBe(true);
  });
});

describe("deriveExecutionState", () => {
  it("maps draft + ready readiness to 'ready'", () => {
    expect(deriveExecutionState("draft", { ready: true, errors: [], warnings: [] })).toBe("ready");
  });

  it("maps draft + unmet readiness to 'draft'", () => {
    expect(deriveExecutionState("draft", { ready: false, errors: ["x"], warnings: [] })).toBe("draft");
  });

  it("maps active to 'running'", () => {
    expect(deriveExecutionState("active", { ready: true, errors: [], warnings: [] })).toBe("running");
  });

  it("maps paused to 'paused'", () => {
    expect(deriveExecutionState("paused", { ready: true, errors: [], warnings: [] })).toBe("paused");
  });

  it("maps completed to 'completed'", () => {
    expect(deriveExecutionState("completed", { ready: true, errors: [], warnings: [] })).toBe("completed");
  });

  it("has a display label for every state", () => {
    for (const state of ["draft", "ready", "running", "paused", "completed"] as const) {
      expect(CAMPAIGN_EXECUTION_STATE_LABEL[state]).toBeTruthy();
    }
  });
});
