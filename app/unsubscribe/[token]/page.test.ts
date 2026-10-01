import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The confirmation page is what a GET to an unsubscribe link renders —
// including the one-click URL's GET, which redirects here. Link scanners and
// prefetchers issue exactly these GETs, so rendering must never write.
const db = vi.hoisted(() => ({
  getCampaignLead: vi.fn(),
  getLeadById: vi.fn(),
  createSuppression: vi.fn(),
  markCampaignLeadUnsubscribed: vi.fn(),
  recordEmailEvent: vi.fn(),
  updateCampaignLead: vi.fn(),
}));
vi.mock("@/lib/db", () => db);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ __fakeAdminClient: true }) }));

import UnsubscribePage from "./page";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";

const SECRET = "test-unsubscribe-secret";
const RECIPIENT = { userId: "user-1", email: "prospect@example.com", campaignLeadId: "cl-1" };

function legacyToken(campaignLeadId: string) {
  const signature = createHmac("sha256", SECRET).update(campaignLeadId).digest("base64url");
  return `${Buffer.from(campaignLeadId, "utf8").toString("base64url")}.${signature}`;
}

function render(token: string) {
  return UnsubscribePage({ params: Promise.resolve({ token }) });
}

function expectNothingWritten() {
  expect(db.createSuppression).not.toHaveBeenCalled();
  expect(db.markCampaignLeadUnsubscribed).not.toHaveBeenCalled();
  expect(db.recordEmailEvent).not.toHaveBeenCalled();
  expect(db.updateCampaignLead).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", SECRET);
  db.getCampaignLead.mockResolvedValue({ id: "cl-1", lead_id: "lead-1" });
  db.getLeadById.mockResolvedValue({ id: "lead-1", email: "prospect@example.com" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /unsubscribe/[token] — display only", () => {
  it("renders the confirmation for a v2 token without reading or writing the database", async () => {
    await render(signUnsubscribeToken(RECIPIENT));

    expect(db.getCampaignLead).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("renders the confirmation for a legacy token with reads only", async () => {
    await render(legacyToken("cl-1"));

    expect(db.getCampaignLead).toHaveBeenCalledTimes(1);
    expectNothingWritten();
  });

  it("renders 'no longer valid' for an invalid token, writing nothing", async () => {
    await render("not-a-token");

    expectNothingWritten();
  });
});
