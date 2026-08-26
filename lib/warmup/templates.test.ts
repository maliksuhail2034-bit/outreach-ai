import { describe, expect, it } from "vitest";
import { INITIAL_TEMPLATES, REPLY_TEMPLATES, pickTemplate } from "./templates";

describe("templates pools", () => {
  it("has more than one initial template and reply template", () => {
    expect(INITIAL_TEMPLATES.length).toBeGreaterThan(1);
    expect(REPLY_TEMPLATES.length).toBeGreaterThan(1);
  });

  it("every initial template has a non-empty subject and body", () => {
    for (const template of INITIAL_TEMPLATES) {
      expect(template.subject.length).toBeGreaterThan(0);
      expect(template.body.length).toBeGreaterThan(0);
    }
  });
});

describe("pickTemplate", () => {
  it("throws on an empty pool", () => {
    expect(() => pickTemplate([])).toThrow();
  });

  it("returns the only item when the pool has exactly one entry, even with avoidId set", () => {
    const pool = [{ id: "only" }];
    expect(pickTemplate(pool, "only").id).toBe("only");
  });

  it("never returns avoidId when more than one entry exists", () => {
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }];
    for (let i = 0; i < 50; i++) {
      expect(pickTemplate(pool, "a").id).not.toBe("a");
    }
  });

  it("can return any entry when avoidId is not set", () => {
    const pool = [{ id: "a" }, { id: "b" }];
    const seen = new Set(Array.from({ length: 50 }, () => pickTemplate(pool).id));
    expect(seen.size).toBe(2);
  });
});
