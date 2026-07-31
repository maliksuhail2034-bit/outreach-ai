import { describe, expect, it } from "vitest";
import { renderMergeTags, SUPPORTED_MERGE_TAGS, type MergeTagLead } from "./merge-tags";

const lead: MergeTagLead = {
  first_name: "Jane",
  last_name: "Cooper",
  email: "jane@example.com",
  company: "Acme",
  title: "VP Sales",
  custom_fields: { role: "Decision Maker", nested: { value: 42 } },
};

describe("renderMergeTags", () => {
  it("substitutes every built-in tag", () => {
    const text = "Hi {{first_name}} {{last_name}} ({{email}}) at {{company}}, {{job_title}}.";
    const result = renderMergeTags(text, lead);
    expect(result.text).toBe("Hi Jane Cooper (jane@example.com) at Acme, VP Sales.");
    expect(result.missingTags).toEqual([]);
  });

  it("builds full_name from first and last name", () => {
    expect(renderMergeTags("{{full_name}}", lead).text).toBe("Jane Cooper");
  });

  it("resolves custom_fields.* by path, including nested paths", () => {
    expect(renderMergeTags("{{custom_fields.role}}", lead).text).toBe("Decision Maker");
    expect(renderMergeTags("{{custom_fields.nested.value}}", lead).text).toBe("42");
  });

  it("never throws on an unknown tag — falls back to empty string and reports it as missing", () => {
    const result = renderMergeTags("Hello {{not_a_real_tag}}!", lead);
    expect(result.text).toBe("Hello !");
    expect(result.missingTags).toEqual(["not_a_real_tag"]);
  });

  it("falls back to a caller-supplied string instead of empty when provided", () => {
    const result = renderMergeTags("{{not_a_real_tag}}", lead, { fallback: "there" });
    expect(result.text).toBe("there");
  });

  it("treats a null/undefined field the same as a missing tag", () => {
    const noCompany: MergeTagLead = { ...lead, company: null };
    const result = renderMergeTags("{{company}}", noCompany);
    expect(result.text).toBe("");
    expect(result.missingTags).toEqual(["company"]);
  });

  it("resolves an unknown custom_fields path to empty without throwing", () => {
    const result = renderMergeTags("{{custom_fields.does_not_exist}}", lead);
    expect(result.text).toBe("");
    expect(result.missingTags).toEqual(["custom_fields.does_not_exist"]);
  });

  it("handles a lead with no custom_fields at all", () => {
    const noCustomFields: MergeTagLead = { ...lead, custom_fields: null };
    const result = renderMergeTags("{{custom_fields.role}}", noCustomFields);
    expect(result.text).toBe("");
  });

  it("leaves plain text with no tags untouched", () => {
    expect(renderMergeTags("No tags here.", lead).text).toBe("No tags here.");
  });

  it("resolves unsubscribe_link from the precomputed unsubscribeUrl field", () => {
    const withUnsubscribe: MergeTagLead = { ...lead, unsubscribeUrl: "https://app.example.com/unsubscribe/abc" };
    const result = renderMergeTags("Bye: {{unsubscribe_link}}", withUnsubscribe);
    expect(result.text).toBe("Bye: https://app.example.com/unsubscribe/abc");
    expect(result.missingTags).toEqual([]);
  });

  it("treats a missing unsubscribeUrl the same as any other missing tag", () => {
    const result = renderMergeTags("{{unsubscribe_link}}", lead);
    expect(result.text).toBe("");
    expect(result.missingTags).toEqual(["unsubscribe_link"]);
  });

  it("SUPPORTED_MERGE_TAGS lists exactly the built-in resolver keys", () => {
    expect(SUPPORTED_MERGE_TAGS).toEqual(
      expect.arrayContaining(["first_name", "last_name", "full_name", "email", "company", "job_title", "unsubscribe_link"]),
    );
  });
});
