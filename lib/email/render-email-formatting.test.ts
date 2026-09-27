import { describe, expect, it } from "vitest";
import { renderEmailContent } from "./render-email";
import { renderMergeTags, type MergeTagLead } from "./merge-tags";

const lead: MergeTagLead = {
  first_name: "Jane",
  last_name: "Cooper",
  email: "jane+test@example.com",
  company: "Acme",
  title: "VP Sales",
  custom_fields: { calendar: "https://cal.example.com/jane?a=1&b=2" },
};

const render = (body: string, overrides: Partial<MergeTagLead> = {}) =>
  renderEmailContent("Subject", body, { ...lead, ...overrides });

const anchor = (href: string, inner: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>`;

describe("renderEmailContent — rich-text formatting", () => {
  it("I: renders **bold** as <strong>, and strips it from plain text", () => {
    const result = render("This is **important**, {{first_name}}.");
    expect(result.html).toBe("<p>This is <strong>important</strong>, Jane.</p>");
    expect(result.text).toBe("This is important, Jane.");
  });

  it("J: renders *italic* and _italic_ as <em>", () => {
    const result = render("*Quick* note and _another_");
    expect(result.html).toBe("<p><em>Quick</em> note and <em>another</em></p>");
    expect(result.text).toBe("Quick note and another");
  });

  it("renders nested bold and italic", () => {
    expect(render("**Hi _there_ {{first_name}}**").html).toBe("<p><strong>Hi <em>there</em> Jane</strong></p>");
  });

  it("K: renders [text](url) as a clickable link, and 'text (url)' in plain text", () => {
    const result = render("Please [book a call](https://cal.com/acme?x=1&y=2) today.");
    expect(result.html).toBe(`<p>Please ${anchor("https://cal.com/acme?x=1&amp;y=2", "book a call")} today.</p>`);
    expect(result.text).toBe("Please book a call (https://cal.com/acme?x=1&y=2) today.");
  });

  it("K: shows a link whose text is its own URL only once in plain text", () => {
    expect(render("[https://acme.com](https://acme.com)").text).toBe("https://acme.com");
  });

  it("K: resolves variables in link text and in the href (percent-encoded inside a URL)", () => {
    const result = render("[Hi {{first_name}}](https://acme.com/?e={{email}})");
    expect(result.html).toBe(`<p>${anchor("https://acme.com/?e=jane%2Btest%40example.com", "Hi Jane")}</p>`);
  });

  it("K: uses a variable that is the whole href as-is", () => {
    const result = render("[Pick a time]({{custom_fields.calendar}})");
    expect(result.html).toBe(`<p>${anchor("https://cal.example.com/jane?a=1&amp;b=2", "Pick a time")}</p>`);
    expect(result.text).toBe("Pick a time (https://cal.example.com/jane?a=1&b=2)");
  });

  it("L: keeps paragraphs and line breaks around formatting", () => {
    const result = render("Hi {{first_name}},\n\nThis is **one** line\nand _another_.\n\n[Reply](https://acme.com)");
    expect(result.html).toBe(
      [
        "<p>Hi Jane,</p>",
        "<p>This is <strong>one</strong> line<br>\nand <em>another</em>.</p>",
        `<p>${anchor("https://acme.com", "Reply")}</p>`,
      ].join("\n"),
    );
    expect(result.text).toBe("Hi Jane,\n\nThis is one line\nand another.\n\nReply (https://acme.com)");
  });

  it("M: still turns bare URLs into links, including inside formatting", () => {
    const result = render("See https://acme.com/a_b_c. **Or https://acme.com/x**");
    expect(result.html).toBe(
      `<p>See ${anchor("https://acme.com/a_b_c", "https://acme.com/a_b_c")}. <strong>Or ${anchor("https://acme.com/x", "https://acme.com/x")}</strong></p>`,
    );
  });

  describe("N: unsafe URL schemes are never links", () => {
    it.each([
      "[click](javascript:alert(1))",
      "[click](data:text/html,x)",
      "[click](vbscript:x)",
      "[click](mailto:a@b.com)",
    ])("%s stays escaped text", (body) => {
      const result = render(body);
      expect(result.html).not.toContain("<a ");
      expect(result.html).not.toMatch(/href="(?!https?:)/);
    });

    it("drops the link, keeping its text, when a variable makes the href unsafe", () => {
      const result = render("[Open]({{custom_fields.url}})", { custom_fields: { url: "javascript:alert(1)" } });
      expect(result.html).toBe("<p>Open</p>");
      expect(result.text).toBe("Open");
    });

    it("drops the link when a whole-href variable is empty", () => {
      expect(render("[Open]({{custom_fields.missing}})").html).toBe("<p>Open</p>");
    });
  });

  describe("O: lead values can't inject formatting, links or HTML", () => {
    it.each([
      ["Markdown bold", "**Acme**", "<p>Hi **Acme**</p>"],
      ["Markdown italic", "_Acme_", "<p>Hi _Acme_</p>"],
      // The [win](…) syntax stays literal; the bare URL inside it is
      // auto-linked, as any URL in a lead value always has been.
      [
        "a Markdown link",
        "[win](https://evil.example)",
        `<p>Hi [win](${anchor("https://evil.example", "https://evil.example")})</p>`,
      ],
      ["raw HTML", '<b onclick="x">Acme</b>', "<p>Hi &lt;b onclick=&quot;x&quot;&gt;Acme&lt;/b&gt;</p>"],
      ["an escape sequence", "\\*Acme\\*", "<p>Hi \\*Acme\\*</p>"],
      ["a merge tag", "{{email}}", "<p>Hi {{email}}</p>"],
    ])("%s in a lead field stays literal", (_label, company, html) => {
      const result = render("Hi {{company}}", { company });
      expect(result.html).toBe(html);
      expect(result.text).toBe(`Hi ${company}`);
    });

    it("escapes a lead value inside formatting and inside link text", () => {
      const result = render("**{{company}}** [{{company}}](https://acme.com)", { company: "<i>x</i> & **y**" });
      expect(result.html).toBe(
        `<p><strong>&lt;i&gt;x&lt;/i&gt; &amp; **y**</strong> ${anchor("https://acme.com", "&lt;i&gt;x&lt;/i&gt; &amp; **y**")}</p>`,
      );
    });

    it("keeps a multi-line lead value inside formatting on one line", () => {
      expect(render("**{{company}}**", { company: "A\n\nB" }).html).toBe("<p><strong>A B</strong></p>");
    });

    it("can't break out of an href attribute", () => {
      const result = render("[x](https://acme.com/?q={{company}})", { company: '"><script>alert(1)</script>' });
      expect(result.html).not.toContain("<script>");
      expect(result.html).toContain('href="https://acme.com/?q=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E"');
    });
  });

  it("reports missing and unsupported variables from formatting, link text and hrefs", () => {
    const result = render("**{{favorite_color}}** [{{company}}](https://acme.com/{{custom_fields.nope}})", {
      company: null,
    });
    expect(result.unsupportedTags).toEqual(["favorite_color"]);
    expect(result.missingTags).toEqual(["favorite_color", "company", "custom_fields.nope"]);
  });

  describe("a merge tag inside a bare URL is part of the URL", () => {
    it("resolves an alias with spaces straight after a URL, in HTML and plain text", () => {
      const result = render("Go https://acme.com/{{ First Name }} now");
      expect(result.html).toBe(`<p>Go ${anchor("https://acme.com/Jane", "https://acme.com/Jane")} now</p>`);
      expect(result.text).toBe("Go https://acme.com/Jane now");
      expect(result.missingTags).toEqual([]);
    });

    it("keeps sentence punctuation after it outside the link", () => {
      const result = render("See https://acme.com/{{ First Name }}.");
      expect(result.html).toBe(`<p>See ${anchor("https://acme.com/Jane", "https://acme.com/Jane")}.</p>`);
      expect(result.text).toBe("See https://acme.com/Jane.");
    });

    it("still escapes the substituted value", () => {
      const result = render("https://acme.com/{{ First Name }}", { first_name: '"><b>x' });
      expect(result.html).not.toContain("<b>");
      expect(result.html).toContain("&quot;&gt;&lt;b&gt;x");
    });
  });

  it("never formats the subject — it stays plain merged text", () => {
    const result = renderEmailContent("**Hi** {{first_name}} & [x](https://a.com)", "Body", lead);
    expect(result.subject).toBe("**Hi** Jane & [x](https://a.com)");
  });
});

describe("renderEmailContent — V: plain-text bodies render exactly as before", () => {
  const bodies = [
    "Hi {{first_name}},\n\nQuick question about {{company}}.\nThanks!",
    "Visit https://acme.com/pricing?plan=pro&seats=5, or reply.",
    "Tom & Jerry <3 — 5 * 3 * 2, my_var, first_last@acme.com, [notes]",
    "  Leading and trailing whitespace  \n\n\n\nextra blank lines\r\nCRLF\n",
    "{{ First Name }} {{Company Name}} {{unknown_tag}} {{custom_fields.role}}",
    "Go https://acme.com/{{ First Name }}/{{Company Name}}?e={{email}} now",
    "",
  ];

  // What renderEmailContent produced for a plain-text body before the
  // rich-text composer: merge, then escape + linkify + paragraph-wrap.
  function legacyHtml(body: string): string {
    const escape = (value: string) =>
      value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    const linkify = (value: string) =>
      value.replace(/\bhttps?:\/\/[^\s<]+/gi, (match) => {
        const trailing = match.match(/[.,!?;:)\]]+$/)?.[0] ?? "";
        const url = trailing ? match.slice(0, -trailing.length) : match;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
      });
    const merged = renderMergeTags(body, lead).text.replace(/\r\n/g, "\n").trim();
    if (!merged) return "";
    return merged
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${linkify(escape(paragraph)).split("\n").join("<br>\n")}</p>`)
      .join("\n");
  }

  it.each(bodies)("%j", (body) => {
    const result = renderEmailContent("Subject", body, lead);
    expect(result.html).toBe(legacyHtml(body));
    expect(result.text).toBe(renderMergeTags(body, lead).text);
  });
});

describe("renderEmailContent — adversarial input stays fast", () => {
  const LIMIT_MS = 200;
  const fill = (unit: string) => unit.repeat(Math.ceil(20_000 / unit.length)).slice(0, 20_000);

  // Each of these used to rescan the rest of the line for every delimiter
  // (about 21s for "*a " x 6,666). The body limit is 20,000 characters.
  it.each([
    ["unclosed * delimiters", fill("*a ")],
    ["unclosed _ delimiters", fill("_a ")],
    ["unclosed ** delimiters", fill("**a ")],
    ["unclosed *** delimiters", fill("***a ")],
    ["mixed unclosed delimiters", fill("*a _b **c ")],
    ["unclosed ** between closed *…*", fill("**x *a* ")],
    ["deep nesting", `${"*_".repeat(5_000)}x${"_*".repeat(5_000)}`],
    ["unclosed [ and [..](", fill("[a](")],
    ["unclosed {{", fill("{{a ")],
    ["URLs with * and _", fill("https://a.com/*x_ ")],
    ["escapes", fill(String.raw`\*a `)],
    ["realistic formatted text", fill("Hi **{{first_name}}**, _see_ [x](https://a.com) ")],
  ])("%s (20,000 chars) renders in under 200ms", (_label, body) => {
    expect(body.length).toBeGreaterThanOrEqual(20_000);
    const started = performance.now();
    renderEmailContent("Subject", body, lead);
    expect(performance.now() - started).toBeLessThan(LIMIT_MS);
  });

  it("still formats a long line of real formatting correctly", () => {
    const html = renderEmailContent("S", fill("**b** _i_ "), lead).html;
    expect(html.startsWith("<p><strong>b</strong> <em>i</em> <strong>b</strong>")).toBe(true);
  });

  it("finds a closing delimiter after unclosed ones of another kind", () => {
    expect(render("*a _b **c** d*").html).toBe("<p><em>a _b <strong>c</strong> d</em></p>");
  });

  it("an unclosed delimiter doesn't stop a later pair on the same line from formatting", () => {
    expect(render("**x and *a* then *b*").html).toBe("<p>**x and <em>a</em> then <em>b</em></p>");
  });

  it("keeps the deepest nesting the composer writes (link > bold > italic)", () => {
    expect(render("[**_x_**](https://a.com)").html).toBe(`<p>${anchor("https://a.com", "<strong><em>x</em></strong>")}</p>`);
    expect(render("***both*** and **b _i_ b**").html).toBe(
      "<p><strong><em>both</em></strong> and <strong>b <em>i</em> b</strong></p>",
    );
  });
});
