import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandMark, RouteLoading } from "./brand-loader";

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

describe("BrandMark", () => {
  it("renders the approved P mark as decorative, at the requested size", () => {
    const html = render(createElement(BrandMark, { size: 40 }));

    expect(html).toContain('src="/icon.svg"');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="40"');
    expect(html).toContain('height="40"');
  });

  it("loads the mark eagerly — a lazy loader mark would appear late", () => {
    expect(render(createElement(BrandMark))).toContain('loading="eager"');
  });

  it("stops every animation under prefers-reduced-motion", () => {
    const html = render(createElement(BrandMark));

    expect(html).toContain("animate-brand-breathe motion-reduce:animate-none");
    expect(html).toContain("animate-brand-glow motion-reduce:hidden");
  });
});

describe("RouteLoading", () => {
  const html = render(
    createElement(RouteLoading, { label: "Loading leads…" }, createElement("div", { "data-testid": "skeleton" })),
  );

  it("keeps the route's skeleton, hidden from assistive tech", () => {
    expect(html).toMatch(/<div aria-hidden="true" class="dark:opacity-60"><div data-testid="skeleton"><\/div><\/div>/);
  });

  it("marks the region busy and announces the label exactly once", () => {
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain("Loading leads…");
  });
});
