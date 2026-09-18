import { describe, expect, it } from "vitest";
import { renderMergeTags, SUPPORTED_MERGE_TAGS, escapeHtml, unescapeHtml, type MergeTagLead } from "./merge-tags";

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

  describe("user-facing tag aliases", () => {
    it("resolves {{First Name}} the same as {{first_name}}", () => {
      expect(renderMergeTags("{{First Name}}", lead).text).toBe("Jane");
    });

    it("resolves {{Full Name}} the same as {{full_name}}", () => {
      expect(renderMergeTags("{{Full Name}}", lead).text).toBe("Jane Cooper");
    });

    it("resolves {{Company Name}} the same as {{company}}", () => {
      expect(renderMergeTags("{{Company Name}}", lead).text).toBe("Acme");
    });

    it("resolves {{Email}} the same as {{email}}", () => {
      expect(renderMergeTags("{{Email}}", lead).text).toBe("jane@example.com");
    });

    it("resolves {{Job Title}} the same as {{job_title}}", () => {
      expect(renderMergeTags("{{Job Title}}", lead).text).toBe("VP Sales");
    });

    it("does not report an alias as missing or unsupported once resolved", () => {
      const result = renderMergeTags("{{First Name}} at {{Company Name}}", lead);
      expect(result.missingTags).toEqual([]);
      expect(result.unsupportedTags).toEqual([]);
    });

    it("aliases still report a missing value the same as the canonical tag would", () => {
      const noCompany: MergeTagLead = { ...lead, company: null };
      const result = renderMergeTags("{{Company Name}}", noCompany);
      expect(result.text).toBe("");
      expect(result.missingTags).toEqual(["Company Name"]);
      expect(result.unsupportedTags).toEqual([]);
    });
  });

  describe("unsupportedTags", () => {
    it("reports a tag that matches no known tag or alias as unsupported, and still falls back safely", () => {
      const result = renderMergeTags("Hello {{not_a_real_tag}}!", lead);
      expect(result.text).toBe("Hello !");
      expect(result.missingTags).toEqual(["not_a_real_tag"]);
      expect(result.unsupportedTags).toEqual(["not_a_real_tag"]);
    });

    it("does not treat a known tag with no value for this lead as unsupported", () => {
      const noCompany: MergeTagLead = { ...lead, company: null };
      const result = renderMergeTags("{{company}}", noCompany);
      expect(result.missingTags).toEqual(["company"]);
      expect(result.unsupportedTags).toEqual([]);
    });

    it("does not treat an unresolved custom_fields.* path as unsupported", () => {
      const result = renderMergeTags("{{custom_fields.does_not_exist}}", lead);
      expect(result.missingTags).toEqual(["custom_fields.does_not_exist"]);
      expect(result.unsupportedTags).toEqual([]);
    });
  });

  describe("escapeHtml option", () => {
    const maliciousLead: MergeTagLead = {
      ...lead,
      company: `Acme & Co <img src=x onerror=alert(1)> "quoted" 'single'`,
    };

    it("does not escape by default (plain-text context, e.g. a subject line)", () => {
      const result = renderMergeTags("At {{company}}", maliciousLead);
      expect(result.text).toBe(`At Acme & Co <img src=x onerror=alert(1)> "quoted" 'single'`);
    });

    it("escapes HTML-special characters in a resolved value when escapeHtml is true", () => {
      const result = renderMergeTags("At {{company}}", maliciousLead, { escapeHtml: true });
      expect(result.text).toBe(
        "At Acme &amp; Co &lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot; &#39;single&#39;",
      );
    });

    it("never escapes the surrounding template text, only the substituted value", () => {
      const result = renderMergeTags("<p>Hi {{first_name}} & welcome</p>", lead, { escapeHtml: true });
      expect(result.text).toBe("<p>Hi Jane & welcome</p>");
    });

    it("escapes an unsubscribe URL's query-string ampersands too", () => {
      const withUnsubscribe: MergeTagLead = {
        ...lead,
        unsubscribeUrl: "https://app.example.com/unsubscribe/abc?sig=x&t=1",
      };
      const result = renderMergeTags("{{unsubscribe_link}}", withUnsubscribe, { escapeHtml: true });
      expect(result.text).toBe("https://app.example.com/unsubscribe/abc?sig=x&amp;t=1");
    });

    it("leaves the fallback string for a missing tag unescaped either way", () => {
      const result = renderMergeTags("{{not_a_real_tag}}", lead, { fallback: "<default>", escapeHtml: true });
      expect(result.text).toBe("<default>");
    });
  });
});

// Batch 9B: exported for lib/email/send-worker.ts's click-tracking link
// rewriter, which needs the real destination URL out of an
// already-HTML-escaped href="..." attribute.
describe("unescapeHtml", () => {
  it("round-trips every character escapeHtml escapes", () => {
    const original = `<p>"quoted" & 'single' </p>`;
    expect(unescapeHtml(escapeHtml(original))).toBe(original);
  });

  it("decodes a URL's escaped ampersand back to a real one", () => {
    expect(unescapeHtml("https://example.com/page?a=1&amp;b=2")).toBe("https://example.com/page?a=1&b=2");
  });

  it("decodes &amp; last, so a literal '&lt;' round-trips correctly instead of double-decoding into '<'", () => {
    // escapeHtml("&lt;") -> "&amp;lt;" ; unescaping must reverse that exactly.
    const original = "&lt;";
    expect(unescapeHtml(escapeHtml(original))).toBe(original);
  });

  it("leaves a string with no entities unchanged", () => {
    expect(unescapeHtml("https://example.com/plain")).toBe("https://example.com/plain");
  });
});
