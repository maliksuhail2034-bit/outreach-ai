import { describe, expect, it } from "vitest";
import {
  identifyBestStep,
  identifyBiggestStepDropOff,
  identifyWeakestStep,
  summarizeSequenceSteps,
  type EmailEventForAttribution,
  type SendAttemptForStep,
  type SequenceStepMetricsInput,
} from "./sequence-step-metrics";

const STEPS: SequenceStepMetricsInput[] = [
  { stepId: "step-1", order: 1, label: "Step 1" },
  { stepId: "step-2", order: 2, label: "Step 2" },
  { stepId: "step-3", order: 3, label: "Step 3" },
];

function sendAttempt(overrides: Partial<SendAttemptForStep>): SendAttemptForStep {
  return { sequence_step_id: "step-1", status: "sent", provider_message_id: null, ...overrides };
}

function repliedEvent(metadata: unknown): EmailEventForAttribution {
  return { event_type: "replied", metadata };
}

describe("summarizeSequenceSteps", () => {
  it("counts sent attempts per step, ignoring non-'sent' statuses", () => {
    const attempts: SendAttemptForStep[] = [
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-1" }),
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-2" }),
      sendAttempt({ sequence_step_id: "step-1", status: "failed", provider_message_id: null }),
      sendAttempt({ sequence_step_id: "step-2", status: "sent", provider_message_id: "msg-3" }),
    ];

    const result = summarizeSequenceSteps(STEPS, attempts, []);

    expect(result.find((s) => s.stepId === "step-1")?.sentCount).toBe(2);
    expect(result.find((s) => s.stepId === "step-2")?.sentCount).toBe(1);
    expect(result.find((s) => s.stepId === "step-3")?.sentCount).toBe(0);
  });

  it("attributes a reply to the step it references via metadata.inReplyTo", () => {
    const attempts: SendAttemptForStep[] = [
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-1" }),
      sendAttempt({ sequence_step_id: "step-2", status: "sent", provider_message_id: "msg-2" }),
    ];
    const events: EmailEventForAttribution[] = [repliedEvent({ inReplyTo: "msg-2", references: [] })];

    const result = summarizeSequenceSteps(STEPS, attempts, events);

    expect(result.find((s) => s.stepId === "step-2")?.repliedCount).toBe(1);
    expect(result.find((s) => s.stepId === "step-1")?.repliedCount).toBe(0);
  });

  it("falls back to metadata.references when inReplyTo doesn't resolve to a known step", () => {
    const attempts: SendAttemptForStep[] = [
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-1" }),
    ];
    const events: EmailEventForAttribution[] = [
      repliedEvent({ inReplyTo: "unrelated-id", references: ["also-unrelated", "msg-1"] }),
    ];

    const result = summarizeSequenceSteps(STEPS, attempts, events);

    expect(result.find((s) => s.stepId === "step-1")?.repliedCount).toBe(1);
  });

  it("excludes a reply that references nothing this campaign sent (e.g. an address-fallback match)", () => {
    const attempts: SendAttemptForStep[] = [
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-1" }),
    ];
    const events: EmailEventForAttribution[] = [
      repliedEvent({ inReplyTo: null, references: [], matchedVia: "address-fallback" }),
    ];

    const result = summarizeSequenceSteps(STEPS, attempts, events);

    expect(result.every((s) => s.repliedCount === 0)).toBe(true);
  });

  it("ignores non-'replied' events entirely", () => {
    const attempts: SendAttemptForStep[] = [
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-1" }),
    ];
    const events: EmailEventForAttribution[] = [
      { event_type: "bounced", metadata: { inReplyTo: "msg-1" } },
      { event_type: "sent", metadata: {} },
    ];

    const result = summarizeSequenceSteps(STEPS, attempts, events);

    expect(result.every((s) => s.repliedCount === 0)).toBe(true);
  });

  it("computes a null reply rate instead of dividing by zero when a step has no sends", () => {
    const result = summarizeSequenceSteps(STEPS, [], []);
    expect(result.every((s) => s.replyRate === null)).toBe(true);
  });

  it("computes a real reply rate when a step has sends", () => {
    const attempts: SendAttemptForStep[] = [
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-1" }),
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-2" }),
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-3" }),
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-4" }),
    ];
    const events: EmailEventForAttribution[] = [repliedEvent({ inReplyTo: "msg-1", references: [] })];

    const result = summarizeSequenceSteps(STEPS, attempts, events);

    expect(result.find((s) => s.stepId === "step-1")?.replyRate).toBe(25);
  });

  it("never computes delivery/open/click/positive-reply rates — always null, not a fabricated 0%", () => {
    const attempts: SendAttemptForStep[] = [
      sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-1" }),
    ];
    const result = summarizeSequenceSteps(STEPS, attempts, []);
    for (const summary of result) {
      expect(summary.deliveryRate).toBeNull();
      expect(summary.openRate).toBeNull();
      expect(summary.clickRate).toBeNull();
      expect(summary.positiveReplyRate).toBeNull();
    }
  });
});

describe("identifyBestStep / identifyWeakestStep", () => {
  it("picks the highest and lowest reply-rate steps", () => {
    const summaries = summarizeSequenceSteps(
      STEPS,
      [
        ...Array.from({ length: 100 }, (_, i) =>
          sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: `s1-${i}` }),
        ),
        ...Array.from({ length: 100 }, (_, i) =>
          sendAttempt({ sequence_step_id: "step-2", status: "sent", provider_message_id: `s2-${i}` }),
        ),
      ],
      [
        // step-1: 6/100 = 6% reply rate
        ...Array.from({ length: 6 }, (_, i) => repliedEvent({ inReplyTo: `s1-${i}` })),
        // step-2: 1/100 = 1% reply rate
        repliedEvent({ inReplyTo: "s2-0" }),
      ],
    );

    expect(identifyBestStep(summaries)?.stepId).toBe("step-1");
    expect(identifyWeakestStep(summaries)?.stepId).toBe("step-2");
  });

  it("excludes steps with no sends (null reply rate) from both comparisons", () => {
    const summaries = summarizeSequenceSteps(
      STEPS,
      [sendAttempt({ sequence_step_id: "step-1", status: "sent", provider_message_id: "msg-1" })],
      [],
    );
    // step-2 and step-3 have no sends -> null reply rate -> never picked.
    expect(identifyBestStep(summaries)?.stepId).toBe("step-1");
    expect(identifyWeakestStep(summaries)?.stepId).toBe("step-1");
  });

  it("returns null for both when no step has a real reply rate", () => {
    const summaries = summarizeSequenceSteps(STEPS, [], []);
    expect(identifyBestStep(summaries)).toBeNull();
    expect(identifyWeakestStep(summaries)).toBeNull();
  });
});

describe("identifyBiggestStepDropOff", () => {
  it("identifies the step transition with the biggest sent-count attrition", () => {
    const summaries = summarizeSequenceSteps(
      STEPS,
      [
        ...Array.from({ length: 100 }, (_, i) => sendAttempt({ sequence_step_id: "step-1", provider_message_id: `${i}` })),
        ...Array.from({ length: 90 }, (_, i) => sendAttempt({ sequence_step_id: "step-2", provider_message_id: `b${i}` })),
        ...Array.from({ length: 20 }, (_, i) => sendAttempt({ sequence_step_id: "step-3", provider_message_id: `c${i}` })),
      ],
      [],
    );

    const result = identifyBiggestStepDropOff(summaries);
    expect(result?.fromKey).toBe("step-2");
    expect(result?.toKey).toBe("step-3");
  });

  it("returns null with fewer than two steps that have any sends", () => {
    const summaries = summarizeSequenceSteps(
      [{ stepId: "only-step", order: 1, label: "Step 1" }],
      [sendAttempt({ sequence_step_id: "only-step", provider_message_id: "msg-1" })],
      [],
    );
    expect(identifyBiggestStepDropOff(summaries)).toBeNull();
  });

  it("returns null when every step has zero sends", () => {
    const summaries = summarizeSequenceSteps(STEPS, [], []);
    expect(identifyBiggestStepDropOff(summaries)).toBeNull();
  });
});
