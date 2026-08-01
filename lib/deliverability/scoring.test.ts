import { describe, expect, it } from "vitest";
import { calculateDomainHealthScore, calculateMailboxHealthScore } from "./scoring";

describe("calculateDomainHealthScore", () => {
  it("scores 100 when every DNS check passes and no reputation is known", () => {
    expect(
      calculateDomainHealthScore({ spfVerified: true, dkimVerified: true, dmarcVerified: true, mxVerified: true }),
    ).toBe(100);
  });

  it("scores 0 when nothing is verified", () => {
    expect(
      calculateDomainHealthScore({ spfVerified: false, dkimVerified: false, dmarcVerified: false, mxVerified: false }),
    ).toBe(0);
  });

  it("scores 50 when exactly half the DNS checks pass", () => {
    expect(
      calculateDomainHealthScore({ spfVerified: true, dkimVerified: true, dmarcVerified: false, mxVerified: false }),
    ).toBe(50);
  });

  it("folds in a reputation score as a fifth equally-weighted signal once available", () => {
    const allDnsPassing = { spfVerified: true, dkimVerified: true, dmarcVerified: true, mxVerified: true };
    // 4 signals at 100 + 1 signal at 0 = average 80.
    expect(calculateDomainHealthScore({ ...allDnsPassing, reputationScore: 0 })).toBe(80);
  });

  it("ignores a null reputation score the same as a missing one", () => {
    const allDnsPassing = { spfVerified: true, dkimVerified: true, dmarcVerified: true, mxVerified: true };
    expect(calculateDomainHealthScore({ ...allDnsPassing, reputationScore: null })).toBe(100);
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
