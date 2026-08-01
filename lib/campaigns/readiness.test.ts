import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_EXECUTION_STATE_LABEL,
  checkCampaignReadiness,
  deriveExecutionState,
  resolveLeadMailboxId,
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
