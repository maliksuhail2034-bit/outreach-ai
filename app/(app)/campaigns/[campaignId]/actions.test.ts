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

import { requireUser } from "@/lib/supabase/auth";
import { getCampaign, getCampaignLead, getUserOrganization, updateCampaignLead } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { sendNowAction } from "./actions";
import type { Tables } from "@/types/database.types";

const mockRequireUser = vi.mocked(requireUser);
const mockGetCampaign = vi.mocked(getCampaign);
const mockGetCampaignLead = vi.mocked(getCampaignLead);
const mockUpdateCampaignLead = vi.mocked(updateCampaignLead);
const mockGetUserOrganization = vi.mocked(getUserOrganization);
const mockCheckRateLimit = vi.mocked(checkRateLimit);

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
