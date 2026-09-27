import { describe, expect, it } from "vitest";
import {
  bodyMarkupToDoc,
  composerMarkupToPlainText,
  docToBodyMarkup,
  docToSubjectText,
  escapeComposerText,
  isSafeLinkHref,
  parseComposerMarkup,
  subjectTextToDoc,
  type ComposerJsonNode,
} from "./composer-markup";

const text = (value: string, marks?: ComposerJsonNode["marks"]): ComposerJsonNode =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const chip = (tag: string, marks?: ComposerJsonNode["marks"]): ComposerJsonNode =>
  marks ? { type: "mergeTag", attrs: { tag }, marks } : { type: "mergeTag", attrs: { tag } };
const doc = (...paragraphs: ComposerJsonNode[][]): ComposerJsonNode => ({
  type: "doc",
  content: paragraphs.map((content) => ({ type: "paragraph", content })),
});
const bold = { type: "bold" };
const italic = { type: "italic" };
const link = (href: string) => ({ type: "link", attrs: { href } });

describe("parseComposerMarkup", () => {
  it("parses plain text with no syntax to itself", () => {
    expect(parseComposerMarkup("Hi there, how are you?")).toEqual([{ type: "text", text: "Hi there, how are you?" }]);
  });

  it("parses merge tags, including alias spellings, as tags", () => {
    expect(parseComposerMarkup("Hi {{first_name}} at {{ Company Name }}")).toEqual([
      { type: "text", text: "Hi " },
      { type: "tag", tag: "first_name" },
      { type: "text", text: " at " },
      { type: "tag", tag: "Company Name" },
    ]);
  });

  it("parses **bold**, *italic* and _italic_", () => {
    expect(parseComposerMarkup("**a** *b* _c_")).toEqual([
      { type: "bold", children: [{ type: "text", text: "a" }] },
      { type: "text", text: " " },
      { type: "italic", children: [{ type: "text", text: "b" }] },
      { type: "text", text: " " },
      { type: "italic", children: [{ type: "text", text: "c" }] },
    ]);
  });

  it("parses nested bold and italic", () => {
    expect(parseComposerMarkup("**a _b_ c**")).toEqual([
      {
        type: "bold",
        children: [
          { type: "text", text: "a " },
          { type: "italic", children: [{ type: "text", text: "b" }] },
          { type: "text", text: " c" },
        ],
      },
    ]);
  });

  it("parses [text](https://…) links, with formatting and tags in the text", () => {
    expect(parseComposerMarkup("[**Book**, {{first_name}}](https://cal.com/x)")).toEqual([
      {
        type: "link",
        href: "https://cal.com/x",
        children: [
          { type: "bold", children: [{ type: "text", text: "Book" }] },
          { type: "text", text: ", " },
          { type: "tag", tag: "first_name" },
        ],
      },
    ]);
  });

  describe("is conservative with ordinary text", () => {
    it.each([
      ["arithmetic with spaced asterisks", "5 * 3 * 2 = 30"],
      ["snake_case words", "my_variable_name and first_last@acme.com"],
      ["an unclosed delimiter", "**not closed and *also not"],
      ["delimiters around whitespace", "** spaced ** and * spaced *"],
      ["brackets that aren't a link", "[Name] (see notes)"],
      ["a non-http link target", "[click](javascript:alert(1))"],
      ["formatting that would span a line", "**first\nsecond**"],
    ])("leaves %s as literal text", (_label, source) => {
      expect(composerMarkupToPlainText(source)).toBe(source);
    });

    it("keeps * and _ inside a bare URL literal", () => {
      const url = "https://acme.com/a_b_c/*x*/_y_";
      expect(parseComposerMarkup(`See ${url} now`)).toEqual([{ type: "text", text: `See ${url} now` }]);
    });

    it("still resolves a merge tag inside a bare URL", () => {
      expect(parseComposerMarkup("https://acme.com/?ref={{email}}")).toEqual([
        { type: "text", text: "https://acme.com/?ref=" },
        { type: "tag", tag: "email" },
      ]);
    });
  });

  it("treats backslash-escaped syntax characters as literal", () => {
    expect(composerMarkupToPlainText("\\*not italic\\* and \\[x\\](https://a.com)")).toBe(
      "*not italic* and [x](https://a.com)",
    );
  });
});

describe("isSafeLinkHref", () => {
  it.each([
    "https://acme.com",
    "http://acme.com/path?q=1&r=2",
    "https://acme.com/?ref={{email}}",
    "{{unsubscribe_link}}",
    "{{custom_fields.calendar}}",
  ])("allows %s", (href) => {
    expect(isSafeLinkHref(href)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "mailto:a@b.com",
    "//acme.com",
    "acme.com",
    'https://acme.com/"onmouseover="x',
    "https://acme.com/a b",
    "{{a}}{{b}}",
    "x{{unsubscribe_link}}",
  ])("rejects %s", (href) => {
    expect(isSafeLinkHref(href)).toBe(false);
  });
});

describe("bodyMarkupToDoc (loading a stored body into the editor)", () => {
  it("E: converts existing {{variable}} text into chips", () => {
    expect(bodyMarkupToDoc("Hi {{first_name}}, from {{company}}")).toEqual(
      doc([text("Hi "), chip("first_name"), text(", from "), chip("company")]),
    );
  });

  it("splits blank-line paragraphs and keeps single line breaks", () => {
    expect(bodyMarkupToDoc("One\nstill one\n\nTwo\r\n\r\nThree")).toEqual(
      doc([text("One"), { type: "hardBreak" }, text("still one")], [text("Two")], [text("Three")]),
    );
  });

  it("maps formatting to marks", () => {
    expect(bodyMarkupToDoc("**b {{first_name}}** [go](https://a.com)")).toEqual(
      doc([text("b ", [bold]), chip("first_name", [bold]), text(" "), text("go", [link("https://a.com")])]),
    );
  });

  it("loads an empty body as one empty paragraph", () => {
    expect(bodyMarkupToDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});

describe("docToBodyMarkup (saving the editor)", () => {
  it("F: serializes chips to canonical {{variable}} syntax", () => {
    expect(docToBodyMarkup(doc([text("Hi "), chip("first_name"), text(" at "), chip("company")]))).toBe(
      "Hi {{first_name}} at {{company}}",
    );
  });

  it("H: keeps an unknown variable as written rather than dropping it", () => {
    expect(docToBodyMarkup(doc([chip("favorite_color")]))).toBe("{{favorite_color}}");
  });

  it("drops braces from a pasted chip's tag so it can't break out of {{…}}", () => {
    expect(docToBodyMarkup(doc([chip("a}}{{b")]))).toBe("{{ab}}");
    expect(docToBodyMarkup(doc([chip("{}")]))).toBe("");
  });

  it("I/J: serializes bold and italic, keeping spaces outside the delimiters", () => {
    expect(docToBodyMarkup(doc([text("a "), text(" bold ", [bold]), text(" "), text("it", [italic])]))).toBe(
      "a  **bold**  _it_",
    );
  });

  it("uses * for italic inside a word, where _ can't delimit", () => {
    expect(docToBodyMarkup(doc([text("un"), text("believ", [italic]), text("able")]))).toBe("un*believ*able");
  });

  it("K: serializes a link, dropping one with an unsafe href", () => {
    expect(docToBodyMarkup(doc([text("Book", [link("https://cal.com/x")])]))).toBe("[Book](https://cal.com/x)");
    expect(docToBodyMarkup(doc([text("Bad", [link("javascript:alert(1)")])]))).toBe("Bad");
  });

  it("L: joins paragraphs with a blank line and line breaks with a newline", () => {
    expect(docToBodyMarkup(doc([text("a"), { type: "hardBreak" }, text("b")], [text("c")]))).toBe("a\nb\n\nc");
  });

  it("escapes typed syntax characters so they stay literal", () => {
    expect(docToBodyMarkup(doc([text("*star* [x](https://a.com) _u_ snake_case")]))).toBe(
      "\\*star\\* \\[x\\](https://a.com) \\_u\\_ snake_case",
    );
  });

  it("drops a mid-word italic touching a bold edge rather than saving broken asterisks", () => {
    const markup = docToBodyMarkup(doc([text("a", [bold]), text("b", [bold, italic]), text("c")]));
    expect(markup).toBe("**ab**c");
    expect(composerMarkupToPlainText(markup)).toBe("abc");
  });

  describe("round-trips through the parser", () => {
    const cases: [string, ComposerJsonNode][] = [
      ["plain text", doc([text("Hello there.")])],
      ["chips", doc([text("Hi "), chip("first_name"), text("!")])],
      ["bold+italic overlap", doc([text("bold ", [bold]), text("both", [bold, italic]), text(" it", [italic])])],
      ["intraword italic", doc([text("un"), text("believ", [italic]), text("able")])],
      ["bold chip in a link", doc([text("Hi ", [link("https://a.com")]), chip("first_name", [link("https://a.com"), bold])])],
      ["literal syntax", doc([text("*a* _b_ [c] \\ d\\")])],
      ["bold URL text", doc([text("https://acme.com/x_y", [bold])])],
      ["paragraphs and breaks", doc([text("a"), { type: "hardBreak" }, text("b")], [text("c")])],
    ];

    it.each(cases)("%s", (_label, original) => {
      const markup = docToBodyMarkup(original);
      expect(docToBodyMarkup(bodyMarkupToDoc(markup))).toBe(markup);
      expect(bodyMarkupToDoc(markup)).toEqual(bodyMarkupToDoc(docToBodyMarkup(bodyMarkupToDoc(markup))));
    });
  });
});

describe("escapeComposerText", () => {
  it("leaves bare URLs and snake_case untouched", () => {
    expect(escapeComposerText("see https://acme.com/a_b*c and first_name")).toBe(
      "see https://acme.com/a_b*c and first_name",
    );
  });
});

describe("subject conversion", () => {
  it("G: loads {{variables}} in a subject as chips", () => {
    expect(subjectTextToDoc("Quick question, {{first_name}}")).toEqual(
      doc([text("Quick question, "), chip("first_name")]),
    );
  });

  it("G: serializes subject chips to {{variable}} and never adds formatting syntax", () => {
    expect(docToSubjectText(doc([text("5 * 3 for "), chip("company", [bold])]))).toBe("5 * 3 for {{company}}");
  });

  it("joins pasted lines with a space", () => {
    expect(docToSubjectText(doc([text("One")], [text("Two")]))).toBe("One Two");
  });
});

describe("adversarial input stays fast in the editor round trip", () => {
  const fill = (unit: string) => unit.repeat(Math.ceil(20_000 / unit.length)).slice(0, 20_000);

  // The editor loads (bodyMarkupToDoc) and saves (docToBodyMarkup) on every
  // keystroke, so this path gets the same 20,000-character budget as sending.
  it.each([
    ["unclosed * delimiters", fill("*a ")],
    ["unclosed _ delimiters", fill("_a ")],
    ["unclosed ** between closed *…*", fill("**x *a* ")],
    ["realistic formatted text", fill("Hi **{{first_name}}**, _see_ [x](https://a.com) ")],
  ])("%s (20,000 chars) loads and saves in under 200ms", (_label, body) => {
    const started = performance.now();
    docToBodyMarkup(bodyMarkupToDoc(body));
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("a merge tag inside a bare URL", () => {
  it("stays part of the URL, even an alias with spaces", () => {
    expect(parseComposerMarkup("Go https://acme.com/{{ First Name }}_x_ now")).toEqual([
      { type: "text", text: "Go https://acme.com/" },
      { type: "tag", tag: "First Name" },
      { type: "text", text: "_x_ now" },
    ]);
  });
});
