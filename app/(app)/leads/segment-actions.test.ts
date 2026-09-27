import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({
  createLeadSegment: vi.fn(),
  updateLeadSegment: vi.fn(),
  deleteLeadSegment: vi.fn(),
  listLeadLists: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createLeadSegment, deleteLeadSegment, listLeadLists, updateLeadSegment } from "@/lib/db";
import { createLeadSegmentAction, deleteLeadSegmentAction, updateLeadSegmentAction } from "./segment-actions";

const mockRequireUser = vi.mocked(requireUser);
const mockCreate = vi.mocked(createLeadSegment);
const mockUpdate = vi.mocked(updateLeadSegment);
const mockDelete = vi.mocked(deleteLeadSegment);
const mockListLeadLists = vi.mocked(listLeadLists);

const OWN_LIST = "11111111-1111-4111-8111-111111111111";
const OTHER_LIST = "22222222-2222-4222-8222-222222222222";
const STATUS_RULE = { field: "status", operator: "is", value: "new" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ id: "user-1" } as never);
  mockListLeadLists.mockResolvedValue([{ id: OWN_LIST }] as never);
  mockCreate.mockResolvedValue({ id: "seg-1" } as never);
  mockUpdate.mockResolvedValue({ id: "seg-1" } as never);
  mockDelete.mockResolvedValue(undefined);
});

describe("createLeadSegmentAction", () => {
  it("stores the validated segment under the signed-in user", async () => {
    await createLeadSegmentAction({ name: "  New leads  ", description: "", rules: [STATUS_RULE] });

    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), {
      user_id: "user-1",
      name: "New leads",
      description: null,
      rules: [STATUS_RULE],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/leads");
  });

  it("never takes the owner from the input", async () => {
    await createLeadSegmentAction({ name: "Sneaky", rules: [STATUS_RULE], user_id: "user-2" } as never);
    expect(mockCreate.mock.calls[0][1]).toMatchObject({ user_id: "user-1" });
  });

  it("rejects invalid rules before touching the database", async () => {
    await expect(
      createLeadSegmentAction({ name: "Bad", rules: [{ field: "custom_fields", operator: "equals", value: "x" }] } as never),
    ).rejects.toThrow();
    await expect(createLeadSegmentAction({ name: "Empty", rules: [] })).rejects.toThrow();
    expect(mockRequireUser).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("allows a rule on the user's own list", async () => {
    await createLeadSegmentAction({ name: "List", rules: [{ field: "list_id", operator: "in", values: [OWN_LIST] }] });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses a rule on a list the user doesn't own", async () => {
    await expect(
      createLeadSegmentAction({ name: "List", rules: [{ field: "list_id", operator: "in", values: [OWN_LIST, OTHER_LIST] }] }),
    ).rejects.toThrow(/your own lead lists/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("skips the list lookup when no rule names a list", async () => {
    await createLeadSegmentAction({ name: "Status", rules: [STATUS_RULE] });
    expect(mockListLeadLists).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out caller", async () => {
    mockRequireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(createLeadSegmentAction({ name: "X", rules: [STATUS_RULE] })).rejects.toThrow("NEXT_REDIRECT");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("updateLeadSegmentAction", () => {
  it("updates only the caller's segment, with validated values", async () => {
    await updateLeadSegmentAction("seg-1", { name: "Renamed", description: "Desc", rules: [STATUS_RULE] });

    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), "user-1", "seg-1", {
      name: "Renamed",
      description: "Desc",
      rules: [STATUS_RULE],
    });
  });

  it("refuses switching a rule to a list the user doesn't own", async () => {
    await expect(
      updateLeadSegmentAction("seg-1", { name: "X", rules: [{ field: "list_id", operator: "in", values: [OTHER_LIST] }] }),
    ).rejects.toThrow(/your own lead lists/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteLeadSegmentAction", () => {
  it("deletes only the caller's segment", async () => {
    await deleteLeadSegmentAction("seg-1");
    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), "user-1", "seg-1");
    expect(revalidatePath).toHaveBeenCalledWith("/leads");
  });

  it("does nothing for a signed-out caller", async () => {
    mockRequireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(deleteLeadSegmentAction("seg-1")).rejects.toThrow("NEXT_REDIRECT");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
