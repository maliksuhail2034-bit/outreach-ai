import { describe, expect, it } from "vitest";
import { summarizeDomainMetrics } from "./domain-metrics";

function events(eventType: string, count: number) {
  return Array.from({ length: count }, () => ({ event_type: eventType }));
}

describe("summarizeDomainMetrics", () => {
  it("aggregates event counts across every mailbox's events into one summary", () => {
    // Mixing "mailboxes" worth of events into one flat array, the same
    // shape a domain's combined event list already arrives in.
    const combined = [
      ...events("sent", 100),
      ...events("delivered", 95),
      ...events("opened", 40),
      ...events("replied", 5),
      ...events("bounced", 5),
    ];

    const summary = summarizeDomainMetrics(combined);

    expect(summary.sentCount).toBe(100);
    expect(summary.deliveredCount).toBe(95);
    expect(summary.deliveryRate).toBe(95);
    expect(summary.openRate).toBeCloseTo(42.1, 1); // 40 / 95
    expect(summary.replyRate).toBe(5);
    expect(summary.bounceRate).toBe(5);
  });

  it("returns null rates instead of dividing by zero for a domain with no activity yet", () => {
    const summary = summarizeDomainMetrics([]);
    expect(summary.sentCount).toBe(0);
    expect(summary.deliveryRate).toBeNull();
    expect(summary.replyRate).toBeNull();
    expect(summary.bounceRate).toBeNull();
  });

  it("ignores event types it doesn't recognize rather than miscounting", () => {
    const summary = summarizeDomainMetrics([...events("sent", 10), ...events("unsubscribed", 3)]);
    expect(summary.sentCount).toBe(10);
    expect(summary.deliveredCount).toBe(0);
  });
});
