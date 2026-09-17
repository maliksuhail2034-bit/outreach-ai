import { describe, expect, it } from "vitest";
import {
  findMalformedTags,
  findMissingDataAcrossLeads,
  findUnsupportedTags,
  validateSequenceTemplates,
} from "./validate-template";
import type { MergeTagLead } from "./merge-tags";

describe("findUnsupportedTags", () => {
  it("flags a tag name that isn't a real merge tag", () => {
    const issues = findUnsupportedTags("Subject", "Hi {{not_a_real_tag}}!");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: "unsupported_tag", tag: "not_a_real_tag" });
  });

  it("does not flag any canonical tag", () => {
    const issues = findUnsupportedTags(
      "{{full_name}}",
      "Hi {{first_name}}, I saw {{company}} is hiring a {{job_title}}. {{email}}",
    );
    expect(issues).toEqual([]);
  });

  it("does not flag a supported user-facing alias", () => {
    expect(findUnsupportedTags("Hi {{First Name}}", "At {{Company Name}}")).toEqual([]);
  });

  it("does not flag a valid template with no merge tags at all", () => {
    expect(findUnsupportedTags("Quick question", "Just checking in, no personalization here.")).toEqual([]);
  });
});

describe("findMalformedTags", () => {
  it("returns no issues for an empty string", () => {
    expect(findMalformedTags("")).toEqual([]);
  });

  it("does not flag a well-formed double-brace tag", () => {
    expect(findMalformedTags("Hi {{first_name}}, welcome to {{company}}.")).toEqual([]);
  });

  it("does not flag a well-formed alias with spaces inside double braces", () => {
    expect(findMalformedTags("Hi {{First Name}}")).toEqual([]);
  });

  it("flags a single-brace typo that looks like a merge tag", () => {
    const issues = findMalformedTags("Hi {first_name}, welcome");
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "malformed_tag", tag: "first_name" }),
    );
  });

  it("flags a single-brace typo with a human-facing label", () => {
    const issues = findMalformedTags("Hi {First Name}, welcome");
    expect(issues).toContainEqual(
      expect.objectContaining({ type: "malformed_tag", tag: "First Name" }),
    );
  });

  it("flags unbalanced double braces", () => {
    const issues = findMalformedTags("Hi {{first_name}, thanks");
    expect(issues.some((issue) => issue.message.includes("unmatched"))).toBe(true);
  });

  it("does not flag ordinary text with no braces at all", () => {
    expect(findMalformedTags("Just a normal sentence with no personalization.")).toEqual([]);
  });

  it("does not double-report the same malformed tag twice", () => {
    const issues = findMalformedTags("{first_name} and {first_name} again");
    const malformedForTag = issues.filter((issue) => issue.tag === "first_name");
    expect(malformedForTag).toHaveLength(1);
  });
});

describe("findMissingDataAcrossLeads", () => {
  const steps = [{ subject: "Hi {{first_name}}", body: "I saw {{company}} is hiring." }];

  it("returns no issues when no leads are provided", () => {
    expect(findMissingDataAcrossLeads(steps, [])).toEqual([]);
  });

  it("flags a canonical tag with no value for some enrolled leads", () => {
    const leads: MergeTagLead[] = [
      { first_name: "Jane", email: "jane@example.com", company: "Acme" },
      { first_name: "Sam", email: "sam@example.com", company: null },
    ];
    const issues = findMissingDataAcrossLeads(steps, leads);
    const companyIssue = issues.find((issue) => issue.tag === "company");
    expect(companyIssue).toBeDefined();
    expect(companyIssue?.message).toContain("1 of");
  });

  it("does not flag a tag every enrolled lead has a value for", () => {
    const leads: MergeTagLead[] = [
      { first_name: "Jane", email: "jane@example.com", company: "Acme" },
      { first_name: "Sam", email: "sam@example.com", company: "Globex" },
    ];
    const issues = findMissingDataAcrossLeads(steps, leads);
    expect(issues.find((issue) => issue.tag === "company")).toBeUndefined();
    expect(issues.find((issue) => issue.tag === "first_name")).toBeUndefined();
  });

  it("does not flag an unsupported tag as missing data (that's findUnsupportedTags's job)", () => {
    const leads: MergeTagLead[] = [{ first_name: "Jane", email: "jane@example.com" }];
    const issues = findMissingDataAcrossLeads(
      [{ subject: "Hi {{not_a_real_tag}}", body: "" }],
      leads,
    );
    expect(issues.find((issue) => issue.tag === "not_a_real_tag")).toBeUndefined();
  });
});

describe("validateSequenceTemplates", () => {
  it("returns no issues for a fully valid template with no leads", () => {
    const steps = [{ subject: "Hi {{first_name}}", body: "I saw {{company}} is hiring a {{job_title}}." }];
    expect(validateSequenceTemplates(steps)).toEqual([]);
  });

  it("returns no issues for a valid template with no merge tags at all", () => {
    const steps = [{ subject: "Quick note", body: "Just checking in — no personalization here." }];
    expect(validateSequenceTemplates(steps)).toEqual([]);
  });

  it("aggregates unsupported-tag and malformed-tag issues across multiple steps", () => {
    const steps = [
      { subject: "Hi {{not_a_real_tag}}", body: "" },
      { subject: "", body: "Hi {first_name}" },
    ];
    const issues = validateSequenceTemplates(steps);
    expect(issues.some((issue) => issue.type === "unsupported_tag" && issue.tag === "not_a_real_tag")).toBe(true);
    expect(issues.some((issue) => issue.type === "malformed_tag" && issue.tag === "first_name")).toBe(true);
  });

  it("deduplicates the same unsupported tag reused across steps", () => {
    const steps = [
      { subject: "Hi {{not_a_real_tag}}", body: "" },
      { subject: "Bye {{not_a_real_tag}}", body: "" },
    ];
    const issues = validateSequenceTemplates(steps);
    expect(issues.filter((issue) => issue.tag === "not_a_real_tag")).toHaveLength(1);
  });

  it("includes missing-data issues when leads are provided", () => {
    const steps = [{ subject: "Hi {{first_name}}", body: "At {{company}}" }];
    const leads: MergeTagLead[] = [{ first_name: "Jane", email: "jane@example.com", company: null }];
    const issues = validateSequenceTemplates(steps, leads);
    expect(issues.some((issue) => issue.type === "missing_data" && issue.tag === "company")).toBe(true);
  });
});
