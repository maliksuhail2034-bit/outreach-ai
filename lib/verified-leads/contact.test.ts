import { describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";

const { getDeliveredVerifiedLeadEmail } = vi.hoisted(() => ({ getDeliveredVerifiedLeadEmail: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDeliveredVerifiedLeadEmail }));

import { resolveLeadContact } from "./contact";

const supabase = {} as Client;

describe("resolveLeadContact", () => {
  it("returns the customer's own lead address without touching the pool", async () => {
    const contact = await resolveLeadContact(supabase, { id: "l1", user_id: "u1", email: "own@acme.test", verified_lead_id: null });

    expect(contact).toEqual({ email: "own@acme.test", poolStatus: null });
    expect(getDeliveredVerifiedLeadEmail).not.toHaveBeenCalled();
  });

  it("returns the real address and pool status for a delivered pool lead", async () => {
    getDeliveredVerifiedLeadEmail.mockResolvedValueOnce({ email: "jane@acme.test", status: "active" });
    const lead = { id: "l1", user_id: "u1", email: "verified+vl@leads.polimatiq.invalid", verified_lead_id: "vl" };

    expect(await resolveLeadContact(supabase, lead)).toEqual({ email: "jane@acme.test", poolStatus: "active" });
    expect(getDeliveredVerifiedLeadEmail).toHaveBeenCalledWith(supabase, lead);
  });

  it("never falls back to the placeholder when the delivery doesn't check out", async () => {
    getDeliveredVerifiedLeadEmail.mockResolvedValueOnce(null);

    expect(
      await resolveLeadContact(supabase, { id: "l1", user_id: "u1", email: "verified+vl@leads.polimatiq.invalid", verified_lead_id: "vl" }),
    ).toBeNull();
  });
});
