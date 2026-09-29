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
  // Reply tracking on and already synced — no reply-tracking warning.
  imap_enabled: true,
  imap_uid_validity: 1,
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

// M1: reply tracking (IMAP) is advisory — warnings only, over the same
// mailbox set the active-mailbox check uses.
describe("checkCampaignReadiness — reply tracking", () => {
  const IMAP_OFF_WARNING =
    "Reply tracking is off for: Sales — replies won't be detected, so follow-ups will keep sending to leads who reply.";
  const UNSYNCED_WARNING =
    "Reply tracking hasn't completed its first sync for: Sales — replies received before the first sync are not detected. Wait a few minutes or check the IMAP settings.";

  type Input = Parameters<typeof checkCampaignReadiness>[0];

  function readiness(mailboxes: Input["mailboxes"], overrides: Partial<Input> = {}) {
    return checkCampaignReadiness({
      campaign: { default_mailbox_id: "mailbox-1" },
      campaignLeads: [{ mailbox_id: null }],
      sequenceStepCount: 1,
      mailboxes,
      domainCount: 1,
      ...overrides,
    });
  }

  it("warns but stays launchable when the default mailbox has reply tracking off", () => {
    const result = readiness([{ ...ACTIVE_MAILBOX, imap_enabled: false, imap_uid_validity: null }]);

    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([IMAP_OFF_WARNING]);
  });

  it("warns for a lead's own mailbox override with reply tracking off", () => {
    const override = { ...ACTIVE_MAILBOX, id: "mailbox-2", display_name: "Override", imap_enabled: false };
    const result = readiness([ACTIVE_MAILBOX, override], { campaignLeads: [{ mailbox_id: "mailbox-2" }] });

    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([
      "Reply tracking is off for: Override — replies won't be detected, so follow-ups will keep sending to leads who reply.",
    ]);
  });

  it("warns for a pool mailbox with reply tracking off", () => {
    const poolMailbox = { ...ACTIVE_MAILBOX, id: "mailbox-2", display_name: "Pool", imap_enabled: false };
    const result = readiness([ACTIVE_MAILBOX, poolMailbox], { campaignMailboxes: [{ mailbox_id: "mailbox-2" }] });

    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([
      "Reply tracking is off for: Pool — replies won't be detected, so follow-ups will keep sending to leads who reply.",
    ]);
  });

  it("warns for a pool-only campaign whose pool mailbox hasn't synced yet", () => {
    const poolMailbox = { ...ACTIVE_MAILBOX, id: "mailbox-2", imap_uid_validity: null };
    const result = readiness([poolMailbox], {
      campaign: { default_mailbox_id: null },
      campaignMailboxes: [{ mailbox_id: "mailbox-2" }],
    });

    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([UNSYNCED_WARNING]);
  });

  it("warns when reply tracking is on but has never completed a sync", () => {
    const result = readiness([{ ...ACTIVE_MAILBOX, imap_uid_validity: null }]);

    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([UNSYNCED_WARNING]);
  });

  it("gives no reply-tracking warning once reply tracking is on and has synced", () => {
    const result = readiness([{ ...ACTIVE_MAILBOX, imap_uid_validity: 0 }]);

    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("lists each affected mailbox once, in its own warning per condition", () => {
    const off = { ...ACTIVE_MAILBOX, imap_enabled: false };
    const unsynced = { ...ACTIVE_MAILBOX, id: "mailbox-2", display_name: null, email: "ops@example.com", imap_uid_validity: null };
    const result = readiness([off, unsynced], {
      campaignLeads: [{ mailbox_id: null }, { mailbox_id: null }, { mailbox_id: "mailbox-2" }, { mailbox_id: "mailbox-2" }],
      campaignMailboxes: [{ mailbox_id: "mailbox-1" }, { mailbox_id: "mailbox-2" }],
    });

    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([
      IMAP_OFF_WARNING,
      "Reply tracking hasn't completed its first sync for: ops@example.com — replies received before the first sync are not detected. Wait a few minutes or check the IMAP settings.",
    ]);
  });

  it("keeps an inactive mailbox's blocking error as the only issue for that mailbox", () => {
    const result = readiness([{ ...ACTIVE_MAILBOX, status: "paused", imap_enabled: false }]);

    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(["These mailboxes aren't active: Sales."]);
    expect(result.warnings).toEqual([]);
  });

  it("leaves the existing warnings alongside the reply-tracking one", () => {
    const result = readiness([{ ...ACTIVE_MAILBOX, imap_enabled: false }], { domainCount: 0 });

    expect(result.ready).toBe(true);
    expect(result.warnings).toEqual([
      IMAP_OFF_WARNING,
      "No sending domain configured yet — add one from the Deliverability page for better inbox placement.",
    ]);
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
