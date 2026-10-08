import { existsSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "@/components/marketing/footer";
import { BUSINESS_DETAILS, PLACEHOLDER_LABELS } from "./business-details";
import { LEGAL_PAGES } from "./legal-pages";
import { LegalDocument } from "./legal-document";

import * as terms from "@/app/(legal)/terms/page";
import * as privacy from "@/app/(legal)/privacy/page";
import * as refundPolicy from "@/app/(legal)/refund-policy/page";
import * as acceptableUse from "@/app/(legal)/acceptable-use/page";
import * as support from "@/app/(legal)/support/page";

const PAGES: Record<string, { default: () => React.ReactElement; metadata: Metadata }> = {
  "/terms": terms,
  "/privacy": privacy,
  "/refund-policy": refundPolicy,
  "/acceptable-use": acceptableUse,
  "/support": support,
};

describe("legal pages", () => {
  it("has a page file for every listed legal route", () => {
    for (const page of LEGAL_PAGES) {
      expect(existsSync(join(process.cwd(), "app/(legal)", page.href, "page.tsx")), page.href).toBe(true);
    }
    expect(Object.keys(PAGES).sort()).toEqual(LEGAL_PAGES.map((page) => page.href).sort());
  });

  it.each(LEGAL_PAGES)("$href has its own title, description and canonical URL", ({ href, label }) => {
    const { metadata } = PAGES[href];
    expect(metadata.title).toBe(`${label} | Polimatiq`);
    expect(typeof metadata.description).toBe("string");
    expect(metadata.alternates?.canonical).toBe(href);
  });

  it.each(LEGAL_PAGES)("$href renders one h1 and marks itself current in the legal nav", ({ href, label }) => {
    const html = renderToStaticMarkup(createElement(PAGES[href].default));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(`>${label.replace("&", "&amp;")}</h1>`);
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((match) => match[0]);
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="${href}"`);
  });

  it("only links to legal routes that exist", () => {
    const known = new Set(LEGAL_PAGES.map((page) => page.href));
    for (const href of Object.keys(PAGES)) {
      const html = renderToStaticMarkup(createElement(PAGES[href].default));
      for (const [, target] of html.matchAll(/href="(\/[a-z-]+)(?:#[a-z-]+)?"/g)) {
        if (["/login", "/signup", "/"].includes(target)) continue;
        expect(known.has(target as never), `${href} links to ${target}`).toBe(true);
      }
    }
  });
});

describe("unconfirmed business details", () => {
  it("render as visible placeholders, never as invented values", () => {
    const html = Object.values(PAGES)
      .map((page) => renderToStaticMarkup(createElement(page.default)))
      .join("");
    for (const [field, value] of Object.entries(BUSINESS_DETAILS)) {
      const label = PLACEHOLDER_LABELS[field as keyof typeof BUSINESS_DETAILS];
      if (value === null) expect(html).toContain(`[To be confirmed: ${label}]`);
    }
  });

  it("use the real value once one is set", () => {
    const html = renderToStaticMarkup(
      createElement(LegalDocument, { href: "/terms", title: "T", summary: null, sections: [] }),
    );
    if (BUSINESS_DETAILS.lastUpdated === null) {
      expect(html).toContain(`[To be confirmed: ${PLACEHOLDER_LABELS.lastUpdated}]`);
    } else {
      expect(html).toContain(BUSINESS_DETAILS.lastUpdated);
    }
  });
});

describe("site footer", () => {
  const html = renderToStaticMarkup(createElement(SiteFooter));

  it("links every legal and support page", () => {
    for (const page of LEGAL_PAGES) {
      expect(html).toContain(`href="${page.href}"`);
    }
  });

  it("points section links at the homepage so they work from every public page", () => {
    expect(html).toContain('href="/#features"');
    expect(html).toContain('href="/#how-it-works"');
    expect(html).toContain('href="/#pricing"');
    expect(html).not.toMatch(/href="#/);
  });
});
