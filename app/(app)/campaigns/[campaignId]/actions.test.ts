import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the seam" approach as app/(app)/billing/actions.test.ts and
// app/(app)/campaigns/actions.test.ts — only the DB/auth/rate-limit boundary
// is mocked. This file's other exports (createSequenceStepAction, the
// attachment actions, etc.) are never invoked here, so their own unused
// lib/db imports resolving to `undefined` in this mock is harmless.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db", () => ({
  getCampaign: vi.fn(),
  getCampaignLead: vi.fn(),
  updateCampaignLead: vi.fn(),
  getUserOrganization: vi.fn(),
  // Batch 8: enrollLeadAction/enrollLeadListAction's dependencies.
  getSuppressedEmails: vi.fn(),
  listCampaignMailboxes: vi.fn(),
  listCampaignLeads: vi.fn(),
  addLeadToCampaign: vi.fn(),
  addLeadsToCampaign: vi.fn(),
  listLeads: vi.fn(),
  listSequences: vi.fn(),
  listSequenceSteps: vi.fn(),
  // Batch 8: launchCampaignAction's dependencies, and the mailbox pool
  // membership actions.
  listMailboxes: vi.fn(),
  listDomains: vi.fn(),
  updateCampaign: vi.fn(),
  addCampaignMailbox: vi.fn(),
  removeCampaignMailbox: vi.fn(),
}));
vi.mock("@/lib/rate-limit/check-rate-limit", () => ({
  checkRateLimit: vi.fn(),
  RateLimitError: class RateLimitError extends Error {
    constructor(public readonly retryAfterSeconds: number) {
      super(`Too many attempts. Try again in ${retryAfterSeconds}s.`);
      this.name = "RateLimitError";
    }
  },
}));

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import {
  addCampaignMailbox,
  addLeadsToCampaign,
  addLeadToCampaign,
  getCampaign,
  getCampaignLead,
  getSuppressedEmails,
  getUserOrganization,
  listCampaignLeads,
  listCampaignMailboxes,
  listDomains,
  listLeads,
  listMailboxes,
  listSequences,
  listSequenceSteps,
  removeCampaignMailbox,
  updateCampaign,
  updateCampaignLead,
} from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit/check-rate-limit";
import {
  addCampaignMailboxAction,
  enrollLeadAction,
  enrollLeadListAction,
  launchCampaignAction,
  removeCampaignMailboxAction,
  sendNowAction,
} from "./actions";
import type { Tables } from "@/types/database.types";

const mockRequireUser = vi.mocked(requireUser);
const mockGetCampaign = vi.mocked(getCampaign);
const mockGetCampaignLead = vi.mocked(getCampaignLead);
const mockUpdateCampaignLead = vi.mocked(updateCampaignLead);
const mockGetUserOrganization = vi.mocked(getUserOrganization);
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockGetSuppressedEmails = vi.mocked(getSuppressedEmails);
const mockListCampaignMailboxes = vi.mocked(listCampaignMailboxes);
const mockListCampaignLeads = vi.mocked(listCampaignLeads);
const mockAddLeadToCampaign = vi.mocked(addLeadToCampaign);
const mockAddLeadsToCampaign = vi.mocked(addLeadsToCampaign);
const mockListLeads = vi.mocked(listLeads);
const mockListSequences = vi.mocked(listSequences);
const mockListSequenceSteps = vi.mocked(listSequenceSteps);
const mockListMailboxes = vi.mocked(listMailboxes);
const mockListDomains = vi.mocked(listDomains);
const mockUpdateCampaign = vi.mocked(updateCampaign);
const mockAddCampaignMailbox = vi.mocked(addCampaignMailbox);
const mockRemoveCampaignMailbox = vi.mocked(removeCampaignMailbox);
const mockRevalidatePath = vi.mocked(revalidatePath);

const USER = { id: "user-1", email: "owner@example.com" };
const ORGANIZATION = { id: "org-1" };

function makeCampaign(overrides: Partial<Tables<"campaigns">> = {}): Tables<"campaigns"> {
  return {
    id: "campaign-1",
    user_id: "user-1",
    name: "Q3 outbound",
    status: "active",
    sending_window: {},
    daily_limit: 50,
    default_mailbox_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeCampaignLead(overrides: Partial<Tables<"campaign_leads">> = {}): Tables<"campaign_leads"> {
  return {
    id: "cl-1",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    current_step_id: "step-1",
    status: "active",
    next_send_at: "2026-09-20T09:00:00.000Z",
    locked_until: null,
    last_error: null,
    enrolled_at: "2026-09-01T00:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

// Batch 8: launchCampaignAction fixtures — a minimal active mailbox
// (id/display_name/email/status/daily_limit/hourly_limit is all
// checkCampaignReadiness reads, see lib/campaigns/readiness.ts) and a
// single-step sequence, just enough for readiness to pass and for
// scheduleOnEnrollment's real (unmocked) computeNextSchedule to run without
// throwing.
function makeMailbox(overrides: Partial<{ id: string; display_name: string; email: string; status: string; daily_limit: number; hourly_limit: number }> = {}) {
  return {
    id: "mailbox-1",
    display_name: "Sales",
    email: "sales@example.com",
    status: "active",
    daily_limit: 50,
    hourly_limit: 10,
    ...overrides,
  };
}

function makeSequenceStep(overrides: Partial<Tables<"sequence_steps">> = {}): Tables<"sequence_steps"> {
  return {
    id: "step-1",
    sequence_id: "seq-1",
    step_order: 0,
    day_delay: 0,
    subject: "Hi {{firstName}}",
    body: "Body",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00.000Z"));
  mockRequireUser.mockResolvedValue(USER as never);
  mockGetUserOrganization.mockResolvedValue(ORGANIZATION as never);
  mockCheckRateLimit.mockResolvedValue(undefined);
  mockGetCampaign.mockResolvedValue(makeCampaign() as never);
  mockGetCampaignLead.mockResolvedValue(makeCampaignLead() as never);
  mockUpdateCampaignLead.mockResolvedValue(makeCampaignLead() as never);
  // Batch 8 defaults: no suppression, no pool, no existing leads, no
  // sequence — enrollLeadAction/enrollLeadListAction's tests below override
  // only what each scenario needs.
  mockGetSuppressedEmails.mockResolvedValue(new Map());
  mockListCampaignMailboxes.mockResolvedValue([]);
  mockListCampaignLeads.mockResolvedValue([]);
  mockAddLeadToCampaign.mockResolvedValue(makeCampaignLead() as never);
  mockAddLeadsToCampaign.mockResolvedValue({ inserted: 0, skipped: 0, rows: [] });
  mockListLeads.mockResolvedValue([]);
  mockListSequences.mockResolvedValue([]);
  mockListSequenceSteps.mockResolvedValue([]);
  // launchCampaignAction/addCampaignMailboxAction/removeCampaignMailboxAction
  // defaults — the launchCampaignAction describe block below overrides these
  // per scenario.
  mockListMailboxes.mockResolvedValue([]);
  mockListDomains.mockResolvedValue([]);
  mockUpdateCampaign.mockResolvedValue(makeCampaign({ status: "active" }) as never);
  mockAddCampaignMailbox.mockResolvedValue({
    id: "cm-1",
    campaign_id: "campaign-1",
    mailbox_id: "mailbox-1",
    created_at: "2026-01-01T00:00:00Z",
  } as never);
  mockRemoveCampaignMailbox.mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sendNowAction", () => {
  it("sets next_send_at to now for an eligible, active, queued lead", async () => {
    await sendNowAction("campaign-1", "cl-1");

    expect(mockUpdateCampaignLead).toHaveBeenCalledTimes(1);
    expect(mockUpdateCampaignLead).toHaveBeenCalledWith(expect.anything(), "cl-1", {
      next_send_at: "2026-09-18T12:00:00.000Z",
    });
  });

  it("only ever writes next_send_at — never mailbox_id, status, or current_step_id", async () => {
    await sendNowAction("campaign-1", "cl-1");

    const [, , values] = mockUpdateCampaignLead.mock.calls[0];
    expect(Object.keys(values as object)).toEqual(["next_send_at"]);
  });

  it("is idempotent — calling it twice in a row is safe and never duplicates a queue entry", async () => {
    await sendNowAction("campaign-1", "cl-1");
    await sendNowAction("campaign-1", "cl-1");

    // Two calls, each a plain update of the same single row — never an
    // insert, so there is no way this creates a second queue entry.
    expect(mockUpdateCampaignLead).toHaveBeenCalledTimes(2);
    for (const call of mockUpdateCampaignLead.mock.calls) {
      expect(call[1]).toBe("cl-1");
      expect(Object.keys(call[2] as object)).toEqual(["next_send_at"]);
    }
  });

  it("preserves the lead's assigned mailbox (never reassigns mailbox_id)", async () => {
    mockGetCampaignLead.mockResolvedValue(makeCampaignLead({ mailbox_id: "mailbox-sticky" }) as never);

    await sendNowAction("campaign-1", "cl-1");

    const [, , values] = mockUpdateCampaignLead.mock.calls[0];
    expect(values).not.toHaveProperty("mailbox_id");
  });

  it("rejects when the campaign is paused (respects pause protection)", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ status: "paused" }) as never);

    await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/active campaign/i);
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("rejects when the campaign is a draft", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ status: "draft" }) as never);

    await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/active campaign/i);
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("rejects when the campaign is completed", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ status: "completed" }) as never);

    await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/active campaign/i);
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("rejects a lead that isn't active (e.g. bounced/unsubscribed/completed/needs_review)", async () => {
    for (const status of ["bounced", "unsubscribed", "completed", "needs_review", "failed", "cancelled", "pending"]) {
      mockUpdateCampaignLead.mockClear();
      mockGetCampaignLead.mockResolvedValue(makeCampaignLead({ status }) as never);

      await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/isn't currently active/i);
      expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
    }
  });

  it("rejects a lead with no pending step", async () => {
    mockGetCampaignLead.mockResolvedValue(makeCampaignLead({ current_step_id: null }) as never);

    await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/no pending step/i);
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("rejects a lead with no assigned mailbox", async () => {
    mockGetCampaignLead.mockResolvedValue(makeCampaignLead({ mailbox_id: null }) as never);

    await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/no assigned mailbox/i);
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("rejects a lead that's currently locked by an in-flight send", async () => {
    mockGetCampaignLead.mockResolvedValue(
      makeCampaignLead({ locked_until: "2026-09-18T12:05:00.000Z" }) as never, // 5 min in the future
    );

    await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/already being sent/i);
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("allows a lead whose lock has already expired", async () => {
    mockGetCampaignLead.mockResolvedValue(
      makeCampaignLead({ locked_until: "2026-09-18T11:00:00.000Z" }) as never, // 1 hour in the past
    );

    await sendNowAction("campaign-1", "cl-1");

    expect(mockUpdateCampaignLead).toHaveBeenCalledTimes(1);
  });

  it("rejects a campaign_lead that belongs to a different campaign", async () => {
    mockGetCampaignLead.mockResolvedValue(makeCampaignLead({ campaign_id: "some-other-campaign" }) as never);

    await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/does not belong/i);
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("checks the campaign:send_now rate limit scope", async () => {
    await sendNowAction("campaign-1", "cl-1");
    expect(mockCheckRateLimit).toHaveBeenCalledWith("campaign:send_now", "org-1");
  });

  it("propagates a rate-limit rejection without touching the lead", async () => {
    const { RateLimitError } = await import("@/lib/rate-limit/check-rate-limit");
    mockCheckRateLimit.mockRejectedValue(new RateLimitError(60));

    await expect(sendNowAction("campaign-1", "cl-1")).rejects.toThrow(/too many attempts/i);
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });
});

// Batch 8: mailbox resolution order at enrollment — explicit override wins,
// otherwise round-robin across the configured pool, falling back to
// campaign.default_mailbox_id when there's no pool. confirmSuppressed=true
// throughout so these tests never need to exercise the (unrelated)
// suppression-check branch.
describe("enrollLeadAction", () => {
  it("uses the explicit mailbox override, never touching the pool", async () => {
    await enrollLeadAction("campaign-1", "lead-1", "mailbox-explicit", true);

    expect(mockListCampaignMailboxes).not.toHaveBeenCalled();
    expect(mockAddLeadToCampaign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mailbox_id: "mailbox-explicit" }),
    );
  });

  it("round-robins across the pool using the current enrolled-lead count as the index", async () => {
    mockListCampaignMailboxes.mockResolvedValue([
      { id: "cm-1", campaign_id: "campaign-1", mailbox_id: "mailbox-1", created_at: "2026-01-01T00:00:00Z" },
      { id: "cm-2", campaign_id: "campaign-1", mailbox_id: "mailbox-2", created_at: "2026-01-01T00:00:00Z" },
    ] as never);
    mockListCampaignLeads.mockResolvedValue([makeCampaignLead({ id: "existing-1" })] as never);

    await enrollLeadAction("campaign-1", "lead-1", undefined, true);

    // One existing lead -> enrollment index 1 -> pool[1 % 2] = mailbox-2.
    expect(mockAddLeadToCampaign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mailbox_id: "mailbox-2" }),
    );
  });

  it("falls back to campaign.default_mailbox_id when the pool is empty (backward compatible)", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ default_mailbox_id: "mailbox-default" }) as never);
    mockListCampaignMailboxes.mockResolvedValue([]);

    await enrollLeadAction("campaign-1", "lead-1", undefined, true);

    expect(mockAddLeadToCampaign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mailbox_id: "mailbox-default" }),
    );
  });

  it("never queries the existing lead count when there is no pool (no extra cost for existing campaigns)", async () => {
    mockListCampaignMailboxes.mockResolvedValue([]);

    await enrollLeadAction("campaign-1", "lead-1", undefined, true);

    expect(mockListCampaignLeads).not.toHaveBeenCalled();
  });
});

describe("enrollLeadListAction", () => {
  function makeLead(id: string, overrides: Partial<Tables<"leads">> = {}): Tables<"leads"> {
    return {
      id,
      user_id: "user-1",
      email: `${id}@example.com`,
      first_name: null,
      last_name: null,
      company: null,
      title: null,
      city: null,
      country: null,
      linkedin: null,
      phone: null,
      website: null,
      status: "new",
      list_id: "list-1",
      custom_fields: null,
      verification_status: "unverified",
      verification_detail: null,
      verification_locked_until: null,
      verification_risk_score: null,
      verified_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("passes a resolver that always returns the explicit override, ignoring the pool", async () => {
    mockListLeads.mockResolvedValue([makeLead("lead-a"), makeLead("lead-b")]);

    await enrollLeadListAction("campaign-1", "list-1", "mailbox-explicit", true);

    expect(mockListCampaignMailboxes).not.toHaveBeenCalled();
    const resolver = mockAddLeadsToCampaign.mock.calls[0][3];
    expect(resolver(0)).toBe("mailbox-explicit");
    expect(resolver(5)).toBe("mailbox-explicit");
  });

  it("passes a resolver that round-robins across the pool when there's no override", async () => {
    mockListLeads.mockResolvedValue([makeLead("lead-a"), makeLead("lead-b"), makeLead("lead-c")]);
    mockListCampaignMailboxes.mockResolvedValue([
      { id: "cm-1", campaign_id: "campaign-1", mailbox_id: "mailbox-1", created_at: "2026-01-01T00:00:00Z" },
      { id: "cm-2", campaign_id: "campaign-1", mailbox_id: "mailbox-2", created_at: "2026-01-01T00:00:00Z" },
    ] as never);

    await enrollLeadListAction("campaign-1", "list-1", undefined, true);

    const resolver = mockAddLeadsToCampaign.mock.calls[0][3];
    expect(resolver(0)).toBe("mailbox-1");
    expect(resolver(1)).toBe("mailbox-2");
    expect(resolver(2)).toBe("mailbox-1"); // wraps around
  });

  it("passes a resolver that falls back to campaign.default_mailbox_id when the pool is empty", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ default_mailbox_id: "mailbox-default" }) as never);
    mockListLeads.mockResolvedValue([makeLead("lead-a")]);
    mockListCampaignMailboxes.mockResolvedValue([]);

    await enrollLeadListAction("campaign-1", "list-1", undefined, true);

    const resolver = mockAddLeadsToCampaign.mock.calls[0][3];
    expect(resolver(0)).toBe("mailbox-default");
  });
});

// Batch 8: launch-time backfill for leads enrolled before any mailbox
// config existed (mailbox_id still null) — round-robins across the pool
// when one is configured, same resolution order as enrollment
// (resolvePoolMailboxId ?? resolveLeadMailboxId), and only ever touches
// leads that actually need it.
describe("launchCampaignAction", () => {
  // updateCampaignLead is reused for two different writes per lead in this
  // action: the mailbox_id backfill, and scheduleOnEnrollment's own
  // current_step_id/next_send_at/status write. Isolate just the backfill
  // writes for assertions below.
  function mailboxBackfillCalls() {
    return mockUpdateCampaignLead.mock.calls
      .filter(([, , values]) => values !== null && typeof values === "object" && "mailbox_id" in values)
      .map(([, id, values]) => [id, (values as { mailbox_id: string | null }).mailbox_id]);
  }

  it("backfills leads with no mailbox round-robin across the pool when default_mailbox_id is null (pool-only campaign)", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ status: "draft", default_mailbox_id: null }) as never);
    mockListCampaignLeads.mockResolvedValue([
      makeCampaignLead({ id: "lead-1", mailbox_id: null, status: "pending" }),
      makeCampaignLead({ id: "lead-2", mailbox_id: null, status: "pending" }),
      makeCampaignLead({ id: "lead-3", mailbox_id: null, status: "pending" }),
    ] as never);
    mockListCampaignMailboxes.mockResolvedValue([
      { id: "cm-1", campaign_id: "campaign-1", mailbox_id: "mailbox-1", created_at: "2026-01-01T00:00:00Z" },
      { id: "cm-2", campaign_id: "campaign-1", mailbox_id: "mailbox-2", created_at: "2026-01-01T00:00:00Z" },
    ] as never);
    mockListMailboxes.mockResolvedValue([makeMailbox({ id: "mailbox-1" }), makeMailbox({ id: "mailbox-2" })] as never);
    mockListSequences.mockResolvedValue([{ id: "seq-1", campaign_id: "campaign-1", name: "Default", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }] as never);
    mockListSequenceSteps.mockResolvedValue([makeSequenceStep()]);

    await launchCampaignAction("campaign-1");

    expect(mockUpdateCampaign).toHaveBeenCalledWith(expect.anything(), "user-1", "campaign-1", { status: "active" });
    expect(mailboxBackfillCalls()).toEqual([
      ["lead-1", "mailbox-1"],
      ["lead-2", "mailbox-2"],
      ["lead-3", "mailbox-1"], // wraps around
    ]);
  });

  it("only backfills leads with no mailbox_id, and the rotation index only counts backfilled leads", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ status: "draft", default_mailbox_id: null }) as never);
    mockListCampaignLeads.mockResolvedValue([
      makeCampaignLead({ id: "lead-preassigned", mailbox_id: "mailbox-preassigned", status: "pending" }),
      makeCampaignLead({ id: "lead-null-1", mailbox_id: null, status: "pending" }),
      makeCampaignLead({ id: "lead-null-2", mailbox_id: null, status: "pending" }),
    ] as never);
    mockListCampaignMailboxes.mockResolvedValue([
      { id: "cm-1", campaign_id: "campaign-1", mailbox_id: "mailbox-1", created_at: "2026-01-01T00:00:00Z" },
      { id: "cm-2", campaign_id: "campaign-1", mailbox_id: "mailbox-2", created_at: "2026-01-01T00:00:00Z" },
    ] as never);
    mockListMailboxes.mockResolvedValue([
      makeMailbox({ id: "mailbox-preassigned" }),
      makeMailbox({ id: "mailbox-1" }),
      makeMailbox({ id: "mailbox-2" }),
    ] as never);
    mockListSequences.mockResolvedValue([{ id: "seq-1", campaign_id: "campaign-1", name: "Default", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }] as never);
    mockListSequenceSteps.mockResolvedValue([makeSequenceStep()]);

    await launchCampaignAction("campaign-1");

    // The already-assigned lead is never touched by the backfill; the two
    // null leads get index 0 and 1 (not 1 and 2 — the preassigned lead
    // doesn't consume a rotation slot).
    expect(mailboxBackfillCalls()).toEqual([
      ["lead-null-1", "mailbox-1"],
      ["lead-null-2", "mailbox-2"],
    ]);
  });

  it("blocks launch when leads are genuinely unresolvable (no pool, no default) and never touches any lead", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ status: "draft", default_mailbox_id: null }) as never);
    mockListCampaignLeads.mockResolvedValue([
      makeCampaignLead({ id: "lead-1", mailbox_id: null, status: "pending" }),
    ] as never);
    mockListCampaignMailboxes.mockResolvedValue([]);
    mockListMailboxes.mockResolvedValue([]);
    mockListSequences.mockResolvedValue([{ id: "seq-1", campaign_id: "campaign-1", name: "Default", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }] as never);
    mockListSequenceSteps.mockResolvedValue([makeSequenceStep()]);

    await expect(launchCampaignAction("campaign-1")).rejects.toThrow(/no mailbox assigned/i);

    expect(mockUpdateCampaign).not.toHaveBeenCalled();
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });
});

// Batch 8: mailbox pool membership toggles — both re-check ownership via
// getCampaign before mutating campaign_mailboxes (the DB-level ownership
// trigger is defense-in-depth, not a substitute — see actions.ts's own
// comment), and revalidate the campaign detail path on success.
describe("addCampaignMailboxAction", () => {
  it("checks campaign ownership, adds the mailbox, and revalidates the campaign path", async () => {
    await addCampaignMailboxAction("campaign-1", "mailbox-1");

    expect(mockGetCampaign).toHaveBeenCalledWith(expect.anything(), "user-1", "campaign-1");
    expect(mockAddCampaignMailbox).toHaveBeenCalledWith(expect.anything(), "campaign-1", "mailbox-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns/campaign-1");
  });

  it("never adds the mailbox when the ownership check fails", async () => {
    mockGetCampaign.mockRejectedValue(new Error("not found"));

    await expect(addCampaignMailboxAction("campaign-1", "mailbox-1")).rejects.toThrow();

    expect(mockAddCampaignMailbox).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("removeCampaignMailboxAction", () => {
  it("checks campaign ownership, removes the mailbox, and revalidates the campaign path", async () => {
    await removeCampaignMailboxAction("campaign-1", "mailbox-1");

    expect(mockGetCampaign).toHaveBeenCalledWith(expect.anything(), "user-1", "campaign-1");
    expect(mockRemoveCampaignMailbox).toHaveBeenCalledWith(expect.anything(), "campaign-1", "mailbox-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns/campaign-1");
  });

  it("never removes the mailbox when the ownership check fails", async () => {
    mockGetCampaign.mockRejectedValue(new Error("not found"));

    await expect(removeCampaignMailboxAction("campaign-1", "mailbox-1")).rejects.toThrow();

    expect(mockRemoveCampaignMailbox).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
