import { describe, expect, it } from "vitest";
import { calculateDomainHealthScore, calculateMailboxHealthScore } from "./scoring";

describe("calculateDomainHealthScore", () => {
  const allDnsPassing = { spfVerified: true, dkimVerified: true, dmarcVerified: true, mxVerified: true };
  const noDnsPassing = { spfVerified: false, dkimVerified: false, dmarcVerified: false, mxVerified: false };

  it("scores 100 when every DNS check passes and no reputation is known", () => {
    expect(calculateDomainHealthScore(allDnsPassing).score).toBe(100);
  });

  it("scores 0 when nothing is verified", () => {
    expect(calculateDomainHealthScore(noDnsPassing).score).toBe(0);
  });

  it("scores 50 when exactly half the DNS checks pass", () => {
    expect(
      calculateDomainHealthScore({ spfVerified: true, dkimVerified: true, dmarcVerified: false, mxVerified: false })
        .score,
    ).toBe(50);
  });

  it("folds in a reputation score as a fifth equally-weighted signal once available", () => {
    // 4 signals at 100 + 1 signal at 0 = average 80.
    expect(calculateDomainHealthScore({ ...allDnsPassing, reputationScore: 0 }).score).toBe(80);
  });

  it("ignores a null reputation score the same as a missing one", () => {
    expect(calculateDomainHealthScore({ ...allDnsPassing, reputationScore: null }).score).toBe(100);
  });

  it("folds in delivery, bounce, and reply rate once a domain has real sending history", () => {
    // DNS 4x100 + delivery 98(98) + bounce 1%(80) + reply 8%(80) = 658 / 7 = 94.
    expect(
      calculateDomainHealthScore({ ...allDnsPassing, deliveryRate: 98, bounceRate: 1, replyRate: 8 }).score,
    ).toBe(94);
  });

  it("reports a good DNS health factor when every record is verified", () => {
    const { factors } = calculateDomainHealthScore(allDnsPassing);
    expect(factors).toContainEqual(
      expect.objectContaining({ key: "dns_health", tone: "good" }),
    );
  });

  it("reports a warning DNS health factor when a record is missing", () => {
    const { factors } = calculateDomainHealthScore({ ...allDnsPassing, spfVerified: false });
    expect(factors).toContainEqual(
      expect.objectContaining({ key: "dns_health", tone: "warning" }),
    );
  });

  it("reports good/warning deliverability, bounce, and reply factors only once real data exists", () => {
    expect(calculateDomainHealthScore(allDnsPassing).factors.map((f) => f.key)).toEqual(["dns_health"]);

    const { factors } = calculateDomainHealthScore({
      ...allDnsPassing,
      deliveryRate: 99,
      bounceRate: 1,
      replyRate: 8,
    });
    expect(factors).toContainEqual(expect.objectContaining({ key: "deliverability", tone: "good" }));
    expect(factors).toContainEqual(expect.objectContaining({ key: "bounce_rate", tone: "good" }));
    expect(factors).toContainEqual(expect.objectContaining({ key: "reply_rate", tone: "good" }));
  });

  it("reports warning bounce/reply/deliverability factors when signals are unhealthy", () => {
    const { factors } = calculateDomainHealthScore({
      ...allDnsPassing,
      deliveryRate: 80,
      bounceRate: 6,
      replyRate: 0.5,
    });
    expect(factors).toContainEqual(expect.objectContaining({ key: "deliverability", tone: "warning" }));
    expect(factors).toContainEqual(expect.objectContaining({ key: "bounce_rate", tone: "warning" }));
    expect(factors).toContainEqual(expect.objectContaining({ key: "reply_rate", tone: "warning" }));
  });
});

describe("calculateMailboxHealthScore", () => {
  it("scores 0 for a mailbox that hasn't started warmup and has no other data", () => {
    expect(calculateMailboxHealthScore({ warmupStatus: "not_started" })).toBe(0);
  });

  it("scores 100 for a fully warmed mailbox with no other data", () => {
    expect(calculateMailboxHealthScore({ warmupStatus: "warmed" })).toBe(100);
  });

  it("scores warming and paused between not_started and warmed", () => {
    expect(calculateMailboxHealthScore({ warmupStatus: "warming" })).toBe(50);
    expect(calculateMailboxHealthScore({ warmupStatus: "paused" })).toBe(25);
  });

  it("treats a bounce rate at or above the placeholder ceiling as zero for that signal", () => {
    // warmup(100) + bounce-at-ceiling(0) averaged = 50.
    expect(calculateMailboxHealthScore({ warmupStatus: "warmed", bounceRate: 5 })).toBe(50);
  });

  it("treats a reply rate at or above the placeholder target as full marks for that signal", () => {
    // warmup(0) + reply-at-target(100) averaged = 50.
    expect(calculateMailboxHealthScore({ warmupStatus: "not_started", replyRate: 10 })).toBe(50);
  });

  it("combines every available signal into a single average", () => {
    // warmup warmed(100) + reputation(80) + bounce 2.5%(50) + reply 5%(50) = 280 / 4 = 70.
    expect(
      calculateMailboxHealthScore({
        warmupStatus: "warmed",
        reputationScore: 80,
        bounceRate: 2.5,
        replyRate: 5,
      }),
    ).toBe(70);
  });
});
