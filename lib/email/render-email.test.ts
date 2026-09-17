import { describe, expect, it } from "vitest";
import { renderEmailContent, plainTextToHtml } from "./render-email";
import type { MergeTagLead } from "./merge-tags";

const lead: MergeTagLead = {
  first_name: "Jane",
  last_name: "Cooper",
  email: "jane@example.com",
  company: "Acme",
  title: "VP Sales",
  custom_fields: null,
};

describe("renderEmailContent", () => {
  describe("canonical merge tags", () => {
    it("renders {{first_name}}", () => {
      expect(renderEmailContent("Hi {{first_name}}", "", lead).subject).toBe("Hi Jane");
    });

    it("renders {{company}}", () => {
      expect(renderEmailContent("{{company}} update", "", lead).subject).toBe("Acme update");
    });

    it("renders {{full_name}}", () => {
      expect(renderEmailContent("{{full_name}}", "", lead).subject).toBe("Jane Cooper");
    });

    it("renders {{email}}", () => {
      expect(renderEmailContent("{{email}}", "", lead).subject).toBe("jane@example.com");
    });

    it("renders {{job_title}}", () => {
      expect(renderEmailContent("{{job_title}}", "", lead).subject).toBe("VP Sales");
    });
  });

  describe("user-facing merge tag aliases", () => {
    it("renders {{First Name}}", () => {
      expect(renderEmailContent("Hi {{First Name}}", "", lead).subject).toBe("Hi Jane");
    });

    it("renders {{Company Name}}", () => {
      expect(renderEmailContent("{{Company Name}} update", "", lead).subject).toBe("Acme update");
    });

    it("renders {{Full Name}}", () => {
      expect(renderEmailContent("{{Full Name}}", "", lead).subject).toBe("Jane Cooper");
    });

    it("renders {{Email}}", () => {
      expect(renderEmailContent("{{Email}}", "", lead).subject).toBe("jane@example.com");
    });

    it("renders {{Job Title}}", () => {
      expect(renderEmailContent("{{Job Title}}", "", lead).subject).toBe("VP Sales");
    });
  });

  it("reports an unsupported variable and never leaves the literal placeholder in the output", () => {
    const result = renderEmailContent("Subject", "Hi {{not_a_real_tag}}, welcome.", lead);
    expect(result.unsupportedTags).toEqual(["not_a_real_tag"]);
    expect(result.missingTags).toContain("not_a_real_tag");
    expect(result.text).not.toContain("{{");
    expect(result.html).not.toContain("{{");
    expect(result.text).toBe("Hi , welcome.");
  });

  it("handles a missing first name safely, without inventing a fake value", () => {
    const noFirstName: MergeTagLead = { ...lead, first_name: null };
    const result = renderEmailContent("Subject", "Hi {{first_name}},", noFirstName);
    expect(result.missingTags).toEqual(["first_name"]);
    expect(result.text).toBe("Hi ,");
    expect(result.text).not.toMatch(/null|undefined/i);
  });

  it("handles a missing company safely, without inventing a fake value", () => {
    const noCompany: MergeTagLead = { ...lead, company: null };
    const result = renderEmailContent("Subject", "I saw {{company}} is hiring.", noCompany);
    expect(result.missingTags).toEqual(["company"]);
    expect(result.text).toBe("I saw  is hiring.");
    expect(result.text).not.toMatch(/null|undefined/i);
  });

  it("substitutes multiple variables in one email", () => {
    const result = renderEmailContent(
      "Quick question about {{company}}",
      "Hi {{first_name}}, I saw {{company}} is hiring a {{job_title}}. Reach me at {{email}}.",
      lead,
    );
    expect(result.subject).toBe("Quick question about Acme");
    expect(result.text).toBe("Hi Jane, I saw Acme is hiring a VP Sales. Reach me at jane@example.com.");
    expect(result.missingTags).toEqual([]);
  });

  describe("HTML formatting", () => {
    it("wraps multiple paragraphs (blank-line separated) in separate <p> tags", () => {
      const result = renderEmailContent("Subject", "First paragraph.\n\nSecond paragraph.", lead);
      expect(result.html).toBe("<p>First paragraph.</p>\n<p>Second paragraph.</p>");
    });

    it("preserves single line breaks within a paragraph as <br>", () => {
      const result = renderEmailContent("Subject", "Line one.\nLine two.", lead);
      expect(result.html).toBe("<p>Line one.<br>\nLine two.</p>");
    });

    it("escapes HTML special characters in the sender's own text", () => {
      const result = renderEmailContent("Subject", `Tom & Jerry <3 "quotes" 'apostrophes'`, lead);
      expect(result.html).toBe(
        `<p>Tom &amp; Jerry &lt;3 &quot;quotes&quot; &#39;apostrophes&#39;</p>`,
      );
    });

    it("escapes HTML special characters coming from lead data (merge tag values)", () => {
      const withHtmlCompany: MergeTagLead = { ...lead, company: `Acme & Co "Inc"` };
      const result = renderEmailContent("Subject", "At {{company}}", withHtmlCompany);
      expect(result.html).toBe(`<p>At Acme &amp; Co &quot;Inc&quot;</p>`);
    });

    it("neutralizes a script injection attempt typed directly into the body", () => {
      const result = renderEmailContent("Subject", "Hi <script>alert(1)</script> there", lead);
      expect(result.html).not.toContain("<script>");
      expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("neutralizes a script injection attempt arriving via lead data", () => {
      const maliciousLead: MergeTagLead = { ...lead, company: `<img src=x onerror=alert(1)>` };
      const result = renderEmailContent("Subject", "At {{company}}", maliciousLead);
      expect(result.html).not.toContain("<img");
      expect(result.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("produces empty HTML for an empty body instead of an empty <p></p>", () => {
      expect(renderEmailContent("Subject", "", lead).html).toBe("");
    });
  });

  describe("plain-text output", () => {
    it("preserves the sender's intended line breaks unescaped", () => {
      const result = renderEmailContent("Subject", "First paragraph.\n\nSecond paragraph.\nStill second.", lead);
      expect(result.text).toBe("First paragraph.\n\nSecond paragraph.\nStill second.");
    });

    it("does not HTML-escape the plain-text body", () => {
      const result = renderEmailContent("Subject", `Tom & Jerry <3`, lead);
      expect(result.text).toBe("Tom & Jerry <3");
    });
  });
});

describe("plainTextToHtml", () => {
  it("returns an empty string for empty input", () => {
    expect(plainTextToHtml("")).toBe("");
    expect(plainTextToHtml("   \n  ")).toBe("");
  });

  it("normalizes CRLF line endings the same as LF", () => {
    expect(plainTextToHtml("Line one.\r\nLine two.")).toBe(plainTextToHtml("Line one.\nLine two."));
  });
});
