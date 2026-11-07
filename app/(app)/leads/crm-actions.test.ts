import { beforeEach, describe, expect, it, vi } from "vitest";

// The Leads page's CRM bulk actions and notes.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn(async () => ({ id: "user-1", email: "owner@example.com" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({
  createLeadNote: vi.fn(),
  deleteLeadNote: vi.fn(),
  getLead: vi.fn(),
  moveLeadsToList: vi.fn(),
  setLeadsStatus: vi.fn(),
}));
vi.mock("@/lib/leads/crm-filters", () => ({ resolveBulkLeads: vi.fn() }));
vi.mock("@/lib/billing/limits", () => ({ assertWithinLeadLimit: vi.fn(), PlanLimitError: class extends Error {} }));
vi.mock("@/lib/verification/verify", () => ({ verifyLead: vi.fn() }));
vi.mock("@/lib/rate-limit/check-rate-limit", () => ({ checkRateLimit: vi.fn() }));

import { createLeadNote, deleteLeadNote, getLead, moveLeadsToList, setLeadsStatus } from "@/lib/db";
import { resolveBulkLeads } from "@/lib/leads/crm-filters";
import { addLeadNoteAction, deleteLeadNoteAction, moveLeadsToListAction, setLeadsStatusAction } from "./actions";

const LIST = "44444444-4444-4444-8444-444444444444";
const LEAD = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveBulkLeads).mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
});

describe("moveLeadsToListAction", () => {
  it("moves the resolved leads and reports how many", async () => {
    const result = await moveLeadsToListAction({ target: { query: "engagement=opened" }, listId: LIST });
    expect(result).toEqual({ ok: true, data: { count: 2 } });
    expect(resolveBulkLeads).toHaveBeenCalledWith({}, "user-1", { query: "engagement=opened" });
    expect(moveLeadsToList).toHaveBeenCalledWith({}, "user-1", ["a", "b"], LIST);
  });

  it("takes leads out of their list with an empty list id", async () => {
    await moveLeadsToListAction({ target: { ids: [LEAD] }, listId: "" });
    expect(moveLeadsToList).toHaveBeenCalledWith({}, "user-1", ["a", "b"], null);
  });

  it("says so when nothing matches", async () => {
    vi.mocked(resolveBulkLeads).mockResolvedValue([]);
    expect(await moveLeadsToListAction({ target: { ids: [LEAD] }, listId: LIST })).toMatchObject({ ok: false });
    expect(moveLeadsToList).not.toHaveBeenCalled();
  });

  it("rejects an invalid list id or target", async () => {
    await expect(moveLeadsToListAction({ target: { ids: [LEAD] }, listId: "x" })).rejects.toThrow();
    await expect(moveLeadsToListAction({ target: { ids: [] }, listId: LIST })).rejects.toThrow();
  });
});

describe("setLeadsStatusAction", () => {
  it("sets a pipeline status", async () => {
    expect(await setLeadsStatusAction({ target: { ids: [LEAD] }, status: "won" })).toEqual({ ok: true, data: { count: 2 } });
    expect(setLeadsStatus).toHaveBeenCalledWith({}, "user-1", ["a", "b"], "won");
  });

  it("rejects an unknown status", async () => {
    await expect(setLeadsStatusAction({ target: { ids: [LEAD] }, status: "boss" })).rejects.toThrow();
    expect(setLeadsStatus).not.toHaveBeenCalled();
  });
});

describe("lead notes", () => {
  it("checks the lead is the caller's before adding a trimmed note", async () => {
    await addLeadNoteAction(LEAD, { body: "  Called, wants a demo  " });
    expect(getLead).toHaveBeenCalledWith({}, "user-1", LEAD);
    expect(createLeadNote).toHaveBeenCalledWith({}, "user-1", LEAD, "Called, wants a demo");
  });

  it("refuses an empty note, and a note on someone else's lead", async () => {
    await expect(addLeadNoteAction(LEAD, { body: "   " })).rejects.toThrow();
    vi.mocked(getLead).mockRejectedValue(new Error("not found"));
    await expect(addLeadNoteAction(LEAD, { body: "hi" })).rejects.toThrow("not found");
    expect(createLeadNote).not.toHaveBeenCalled();
  });

  it("deletes only the caller's note", async () => {
    await deleteLeadNoteAction(LEAD, "note-1");
    expect(deleteLeadNote).toHaveBeenCalledWith({}, "user-1", "note-1");
  });
});
