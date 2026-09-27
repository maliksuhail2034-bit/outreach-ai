import { describe, expect, it } from "vitest";
import { MERGE_TAG_OPTIONS, mergeTagChip, mergeTagSyntax } from "./merge-tag-options";
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

describe("mergeTagChip", () => {
  it("labels a canonical picker tag with its friendly label", () => {
    expect(mergeTagChip("first_name")).toEqual({ label: "First Name", supported: true });
  });

  it("shows a supported tag that isn't in the picker as typed", () => {
    expect(mergeTagChip("custom_fields.role")).toEqual({ label: "custom_fields.role", supported: true });
    expect(mergeTagChip("First Name")).toEqual({ label: "First Name", supported: true });
  });

  it("flags an unknown tag as unsupported", () => {
    expect(mergeTagChip("favorite_color")).toEqual({ label: "favorite_color", supported: false });
  });
});
