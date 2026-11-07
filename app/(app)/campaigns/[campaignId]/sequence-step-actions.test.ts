import { beforeEach, describe, expect, it, vi } from "vitest";

// createSequenceStepAction / updateSequenceStepAction: a step's condition is
// stored only when it refers to an earlier step of the same sequence (the
// form offers only those; this is the check for a direct POST).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({
  getCampaign: vi.fn(),
  getOrCreateDefaultSequence: vi.fn(),
  listSequenceSteps: vi.fn(),
  createSequenceStep: vi.fn(),
  getSequenceStep: vi.fn(),
  getSequence: vi.fn(),
  updateSequenceStep: vi.fn(),
}));

import {
  createSequenceStep,
  getCampaign,
  getOrCreateDefaultSequence,
  getSequence,
  getSequenceStep,
  listSequenceSteps,
  updateSequenceStep,
} from "@/lib/db";
import { createSequenceStepAction, updateSequenceStepAction } from "./actions";

const STEP_ONE = "11111111-1111-4111-8111-111111111111";
const STEP_TWO = "22222222-2222-4222-8222-222222222222";
const STEP_THREE = "33333333-3333-4333-8333-333333333333";

function step(id: string, order: number) {
  return { id, sequence_id: "seq-1", step_order: order, day_delay: 3, condition: "always", condition_step_id: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCampaign).mockResolvedValue({ id: "campaign-1", user_id: "user-1" } as never);
  vi.mocked(getOrCreateDefaultSequence).mockResolvedValue({ id: "seq-1", campaign_id: "campaign-1" } as never);
  vi.mocked(getSequence).mockResolvedValue({ id: "seq-1", campaign_id: "campaign-1" } as never);
  vi.mocked(createSequenceStep).mockResolvedValue({ id: STEP_THREE } as never);
  vi.mocked(listSequenceSteps).mockResolvedValue([step(STEP_ONE, 0), step(STEP_TWO, 1)] as never);
});

describe("createSequenceStepAction conditions", () => {
  it("stores a condition on an earlier step", async () => {
    await createSequenceStepAction("campaign-1", { dayDelay: 3, condition: "not_opened", conditionStepId: STEP_ONE });

    expect(createSequenceStep).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ step_order: 2, condition: "not_opened", condition_step_id: STEP_ONE }),
    );
  });

  it("stores 'any earlier email' as a null condition step, and 'always' with no step at all", async () => {
    await createSequenceStepAction("campaign-1", { dayDelay: 3, condition: "clicked", conditionStepId: "" });
    expect(createSequenceStep).toHaveBeenLastCalledWith({}, expect.objectContaining({ condition: "clicked", condition_step_id: null }));

    await createSequenceStepAction("campaign-1", { dayDelay: 3, condition: "always", conditionStepId: STEP_ONE });
    expect(createSequenceStep).toHaveBeenLastCalledWith({}, expect.objectContaining({ condition: "always", condition_step_id: null }));

    await createSequenceStepAction("campaign-1", { dayDelay: 3 });
    expect(createSequenceStep).toHaveBeenLastCalledWith({}, expect.objectContaining({ condition: "always", condition_step_id: null }));
  });

  it("refuses a condition on the first step", async () => {
    vi.mocked(listSequenceSteps).mockResolvedValue([]);
    await expect(createSequenceStepAction("campaign-1", { dayDelay: 0, condition: "opened" })).rejects.toThrow(/first step/);
    expect(createSequenceStep).not.toHaveBeenCalled();
  });

  it("refuses a condition step from another sequence", async () => {
    await expect(
      createSequenceStepAction("campaign-1", { dayDelay: 3, condition: "opened", conditionStepId: "44444444-4444-4444-8444-444444444444" }),
    ).rejects.toThrow(/earlier step/);
    expect(createSequenceStep).not.toHaveBeenCalled();
  });
});

describe("updateSequenceStepAction conditions", () => {
  it("allows only steps before the edited one", async () => {
    vi.mocked(getSequenceStep).mockResolvedValue(step(STEP_TWO, 1) as never);

    await updateSequenceStepAction("campaign-1", STEP_TWO, { dayDelay: 3, condition: "opened", conditionStepId: STEP_ONE });
    expect(updateSequenceStep).toHaveBeenCalledWith({}, STEP_TWO, expect.objectContaining({ condition: "opened", condition_step_id: STEP_ONE }));

    await expect(
      updateSequenceStepAction("campaign-1", STEP_TWO, { dayDelay: 3, condition: "opened", conditionStepId: STEP_TWO }),
    ).rejects.toThrow(/earlier step/);
  });
});
