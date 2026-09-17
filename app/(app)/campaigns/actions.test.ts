import { beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the seam" approach as app/(app)/billing/actions.test.ts — only
// the DB/auth boundary is mocked; lib/email/scheduling.ts (and its luxon
// dependency) run for real, since that's exactly the DST-safe engine this
// batch requires stays untouched and in charge of the actual math.
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
  createCampaign: vi.fn(),
  deleteCampaign: vi.fn(),
  getCampaign: vi.fn(),
  listCampaignLeads: vi.fn(),
  updateCampaign: vi.fn(),
  updateCampaignLead: vi.fn(),
}));
vi.mock("@/lib/billing/limits", () => ({
  assertWithinCampaignLimit: vi.fn(),
  assertWithinDailySendLimit: vi.fn(),
}));

import { requireUser } from "@/lib/supabase/auth";
import { getCampaign, listCampaignLeads, updateCampaign, updateCampaignLead } from "@/lib/db";
import { assertWithinDailySendLimit } from "@/lib/billing/limits";
import { updateCampaignAction } from "./actions";
import type { SendingWindow } from "@/lib/validations/sending-window";
import type { Tables } from "@/types/database.types";

const mockRequireUser = vi.mocked(requireUser);
const mockGetCampaign = vi.mocked(getCampaign);
const mockListCampaignLeads = vi.mocked(listCampaignLeads);
const mockUpdateCampaign = vi.mocked(updateCampaign);
const mockUpdateCampaignLead = vi.mocked(updateCampaignLead);
const mockAssertWithinDailySendLimit = vi.mocked(assertWithinDailySendLimit);

const USER = { id: "user-1", email: "owner@example.com" };

const UTC_9_TO_5: SendingWindow = { days: ["mon", "tue", "wed", "thu", "fri"], startHour: 9, endHour: 17, timezone: "UTC" };
const RIYADH_9_TO_5: SendingWindow = { ...UTC_9_TO_5, timezone: "Asia/Riyadh" };

function makeCampaign(overrides: Partial<Tables<"campaigns">> = {}): Tables<"campaigns"> {
  return {
    id: "campaign-1",
    user_id: "user-1",
    name: "Q3 outbound",
    status: "active",
    sending_window: UTC_9_TO_5,
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
    next_send_at: "2026-08-03T15:00:00.000Z",
    locked_until: null,
    last_error: null,
    enrolled_at: "2026-08-01T00:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const BASE_INPUT = {
  name: "Q3 outbound",
  dailyLimit: 50,
  defaultMailboxId: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue(USER as never);
  mockAssertWithinDailySendLimit.mockResolvedValue(undefined as never);
  mockUpdateCampaign.mockResolvedValue(makeCampaign() as never);
  mockUpdateCampaignLead.mockImplementation(async (_supabase, id, values) =>
    ({ ...makeCampaignLead({ id }), ...values }) as never,
  );
});

describe("updateCampaignAction — schedule-edit recompute", () => {
  it("recomputes next_send_at for active, queued leads when the sending window actually changes", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ sending_window: UTC_9_TO_5 }) as never);
    // 15:00 UTC is inside 9-17 UTC, but outside 9-17 Riyadh (18:00 local) —
    // must roll forward once re-snapped into the new window.
    const lead = makeCampaignLead({ next_send_at: "2026-08-03T15:00:00.000Z" });
    mockListCampaignLeads.mockResolvedValue([lead] as never);

    await updateCampaignAction("campaign-1", { ...BASE_INPUT, sendingWindow: RIYADH_9_TO_5 });

    expect(mockListCampaignLeads).toHaveBeenCalledWith(expect.anything(), "campaign-1", { status: "active" });
    expect(mockUpdateCampaignLead).toHaveBeenCalledWith(
      expect.anything(),
      "cl-1",
      { next_send_at: "2026-08-04T06:00:00.000Z" },
    );
  });

  it("does not touch campaign_leads at all when the sending window is unchanged", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ sending_window: UTC_9_TO_5 }) as never);
    mockListCampaignLeads.mockResolvedValue([makeCampaignLead()] as never);

    await updateCampaignAction("campaign-1", { ...BASE_INPUT, sendingWindow: UTC_9_TO_5, name: "Renamed" });

    expect(mockListCampaignLeads).not.toHaveBeenCalled();
    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("skips a lead whose queued time is already valid under the new window (no-op write avoided)", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ sending_window: UTC_9_TO_5 }) as never);
    // 10:00 UTC = 13:00 Riyadh — already inside the new window.
    const lead = makeCampaignLead({ id: "cl-already-valid", next_send_at: "2026-08-03T10:00:00.000Z" });
    mockListCampaignLeads.mockResolvedValue([lead] as never);

    await updateCampaignAction("campaign-1", { ...BASE_INPUT, sendingWindow: RIYADH_9_TO_5 });

    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("never recomputes a lead with no next_send_at queued", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ sending_window: UTC_9_TO_5 }) as never);
    const notQueued = makeCampaignLead({ id: "cl-not-queued", next_send_at: null });
    mockListCampaignLeads.mockResolvedValue([notQueued] as never);

    await updateCampaignAction("campaign-1", { ...BASE_INPUT, sendingWindow: RIYADH_9_TO_5 });

    expect(mockUpdateCampaignLead).not.toHaveBeenCalled();
  });

  it("only ever writes next_send_at — never mailbox_id, status, or current_step_id (stickiness/sequencing preserved)", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ sending_window: UTC_9_TO_5 }) as never);
    const lead = makeCampaignLead({ next_send_at: "2026-08-03T15:00:00.000Z", mailbox_id: "mailbox-sticky" });
    mockListCampaignLeads.mockResolvedValue([lead] as never);

    await updateCampaignAction("campaign-1", { ...BASE_INPUT, sendingWindow: RIYADH_9_TO_5 });

    expect(mockUpdateCampaignLead).toHaveBeenCalledTimes(1);
    const [, , values] = mockUpdateCampaignLead.mock.calls[0];
    expect(Object.keys(values as object)).toEqual(["next_send_at"]);
  });

  it("only asks for active leads — terminal/already-resolved statuses are never queried for recompute", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ sending_window: UTC_9_TO_5 }) as never);
    mockListCampaignLeads.mockResolvedValue([] as never);

    await updateCampaignAction("campaign-1", { ...BASE_INPUT, sendingWindow: RIYADH_9_TO_5 });

    expect(mockListCampaignLeads).toHaveBeenCalledWith(expect.anything(), "campaign-1", { status: "active" });
  });

  it("recomputes queued leads even for a paused campaign, without changing its paused status", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ status: "paused", sending_window: UTC_9_TO_5 }) as never);
    const lead = makeCampaignLead({ next_send_at: "2026-08-03T15:00:00.000Z" });
    mockListCampaignLeads.mockResolvedValue([lead] as never);

    await updateCampaignAction("campaign-1", { ...BASE_INPUT, sendingWindow: RIYADH_9_TO_5, status: "paused" });

    expect(mockUpdateCampaignLead).toHaveBeenCalledWith(
      expect.anything(),
      "cl-1",
      { next_send_at: "2026-08-04T06:00:00.000Z" },
    );
    // The campaign row itself is only ever updated with what the caller
    // submitted — recompute never touches campaigns.status.
    expect(mockUpdateCampaign).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "campaign-1",
      expect.objectContaining({ status: "paused" }),
    );
  });

  it("recomputes multiple queued leads independently", async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ sending_window: UTC_9_TO_5 }) as never);
    const leadA = makeCampaignLead({ id: "cl-a", next_send_at: "2026-08-03T15:00:00.000Z" });
    const leadB = makeCampaignLead({ id: "cl-b", next_send_at: "2026-08-03T10:00:00.000Z" });
    mockListCampaignLeads.mockResolvedValue([leadA, leadB] as never);

    await updateCampaignAction("campaign-1", { ...BASE_INPUT, sendingWindow: RIYADH_9_TO_5 });

    // leadA (15:00 UTC = 18:00 Riyadh) rolls forward; leadB (10:00 UTC =
    // 13:00 Riyadh) is already valid and must not be written.
    expect(mockUpdateCampaignLead).toHaveBeenCalledTimes(1);
    expect(mockUpdateCampaignLead).toHaveBeenCalledWith(expect.anything(), "cl-a", {
      next_send_at: "2026-08-04T06:00:00.000Z",
    });
  });
});
