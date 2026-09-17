import { describe, expect, it } from "vitest";
import { MERGE_TAG_OPTIONS, insertAtCursor, mergeTagSyntax } from "./merge-tag-options";
import { SUPPORTED_MERGE_TAGS, renderMergeTags } from "./merge-tags";
import { SAMPLE_LEAD } from "./sample-lead";

describe("MERGE_TAG_OPTIONS", () => {
  it("lists exactly the five variables the composer should offer", () => {
    expect(MERGE_TAG_OPTIONS.map((option) => option.label)).toEqual([
      "First Name",
      "Full Name",
      "Company",
      "Email",
      "Job Title",
    ]);
  });

  it("every option's tag is a real canonical merge tag", () => {
    for (const option of MERGE_TAG_OPTIONS) {
      expect(SUPPORTED_MERGE_TAGS).toContain(option.tag);
    }
  });

  it("every option resolves against the sample lead with nothing missing or unsupported", () => {
    for (const option of MERGE_TAG_OPTIONS) {
      const result = renderMergeTags(mergeTagSyntax(option.tag), SAMPLE_LEAD);
      expect(result.missingTags).toEqual([]);
      expect(result.unsupportedTags).toEqual([]);
      expect(result.text.length).toBeGreaterThan(0);
    }
  });
});

describe("mergeTagSyntax", () => {
  it("wraps a canonical tag in the double-brace syntax the renderer expects", () => {
    expect(mergeTagSyntax("first_name")).toBe("{{first_name}}");
  });
});

describe("insertAtCursor", () => {
  it("inserts at an empty-selection caret position", () => {
    const result = insertAtCursor("Hi , welcome", "{{first_name}}", 3, 3);
    expect(result.value).toBe("Hi {{first_name}}, welcome");
    expect(result.cursor).toBe(3 + "{{first_name}}".length);
  });

  it("inserts at the start of an empty field", () => {
    const result = insertAtCursor("", "{{first_name}}", 0, 0);
    expect(result.value).toBe("{{first_name}}");
    expect(result.cursor).toBe("{{first_name}}".length);
  });

  it("inserts at the end of existing text", () => {
    const value = "Hi there, ";
    const result = insertAtCursor(value, "{{first_name}}", value.length, value.length);
    expect(result.value).toBe("Hi there, {{first_name}}");
    expect(result.cursor).toBe(value.length + "{{first_name}}".length);
  });

  it("replaces a non-empty selection with the inserted tag", () => {
    const result = insertAtCursor("Hi NAME, welcome", "{{first_name}}", 3, 7);
    expect(result.value).toBe("Hi {{first_name}}, welcome");
  });

  it("clamps an out-of-range selection instead of throwing", () => {
    const result = insertAtCursor("Hi", "{{first_name}}", 50, 99);
    expect(result.value).toBe("Hi{{first_name}}");
  });

  it("clamps a negative selection instead of throwing", () => {
    const result = insertAtCursor("Hi", "{{first_name}}", -5, -1);
    expect(result.value).toBe("{{first_name}}Hi");
  });

  it("inserts every supported variable's canonical syntax correctly", () => {
    for (const option of MERGE_TAG_OPTIONS) {
      const result = insertAtCursor("", mergeTagSyntax(option.tag), 0, 0);
      expect(result.value).toBe(`{{${option.tag}}}`);
    }
  });
});
