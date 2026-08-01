import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_SUBJECT_TYPES,
  isAnalyticsEventType,
  isAnalyticsSubjectType,
  NEGATIVE_EVENT_TYPES,
  POSITIVE_EVENT_TYPES,
} from "./events";

describe("isAnalyticsEventType", () => {
  it("accepts every catalog entry", () => {
    for (const type of ANALYTICS_EVENT_TYPES) {
      expect(isAnalyticsEventType(type)).toBe(true);
    }
  });

  it("rejects an unrecognized value", () => {
    expect(isAnalyticsEventType("not_a_real_event")).toBe(false);
  });
});

describe("isAnalyticsSubjectType", () => {
  it("accepts every catalog entry", () => {
    for (const type of ANALYTICS_SUBJECT_TYPES) {
      expect(isAnalyticsSubjectType(type)).toBe(true);
    }
  });

  it("rejects an unrecognized value", () => {
    expect(isAnalyticsSubjectType("not_a_real_subject")).toBe(false);
  });
});

describe("POSITIVE_EVENT_TYPES / NEGATIVE_EVENT_TYPES", () => {
  it("don't overlap", () => {
    for (const type of POSITIVE_EVENT_TYPES) {
      expect(NEGATIVE_EVENT_TYPES.has(type)).toBe(false);
    }
  });

  it("only contain catalog event types", () => {
    for (const type of [...POSITIVE_EVENT_TYPES, ...NEGATIVE_EVENT_TYPES]) {
      expect(isAnalyticsEventType(type)).toBe(true);
    }
  });
});
