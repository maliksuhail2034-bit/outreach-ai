import { createHmac } from "crypto";
import { renderToStaticMarkup } from "react-dom/server";
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await render("not-a-token");

    expectNothingWritten();
  });
});

describe("GET /unsubscribe/[token] — links that can no longer be verified", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("tells the recipient how to request removal by email, and that nothing changed yet", async () => {
    const html = renderToStaticMarkup(await render("not-a-token"));

    expect(html).toContain("Link no longer valid");
    expect(html).toContain("nothing has been changed yet");
    expect(html).toContain('href="mailto:support@polimatiq.com?subject=Unsubscribe%20request"');
    expect(html).not.toContain("already been used");
  });

  it("shows the same fallback for a link issued under a previous secret, writing nothing", async () => {
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", "the-previous-deployment-secret");
    const oldLink = signUnsubscribeToken(RECIPIENT);
    vi.stubEnv("UNSUBSCRIBE_TOKEN_SECRET", SECRET);

    const html = renderToStaticMarkup(await render(oldLink));

    expect(html).toContain("support@polimatiq.com");
    expect(html).not.toContain(RECIPIENT.email);
    expectNothingWritten();
  });

  it("logs only the token format, never the token", async () => {
    const token = signUnsubscribeToken(RECIPIENT).slice(0, -6) + "AAAAAA";
    await render(token);

    expect(console.warn).toHaveBeenCalledWith("[unsubscribe] link could not be verified", { format: "v2" });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(token);
  });

  it("doesn't show the fallback for a valid link", async () => {
    const html = renderToStaticMarkup(await render(signUnsubscribeToken(RECIPIENT)));

    expect(html).not.toContain("Link no longer valid");
    expect(console.warn).not.toHaveBeenCalled();
  });
});
