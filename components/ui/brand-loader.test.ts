import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandMarkReveal, RouteLoading } from "./brand-loader";

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("BrandMarkReveal", () => {
  const html = render(createElement(BrandMarkReveal, { size: 64 }));

  it("renders the approved P asset itself, not a redrawn copy, in its own 512×512 space", () => {
    expect(html).toContain('href="/icon.svg"');
    expect(html).toContain('viewBox="0 0 512 512"');
    expect(html).toMatch(/<image href="\/icon\.svg" width="512" height="512" mask="url\(#brand-reveal-[\w-]+\)"/);
    expect(html).toContain('width="64"');
    expect(html).toContain('height="64"');
  });

  it("is decorative — the status lives on RouteLoading", () => {
    expect(html).toContain('aria-hidden="true"');
  });

  it("reveals the mark with a drawn pen mask, not by fading the mark itself", () => {
    expect(html).toMatch(/<mask id="brand-reveal-[\w-]+"/);
    expect(html).toMatch(/<path [^>]*pathLength="1"[^>]*stroke="white"[^>]*stroke-dasharray="1"[^>]*class="animate-brand-draw/);
    // The <image> carries no animation or opacity of its own.
    expect(html).not.toMatch(/<image [^>]*(class|opacity|style)=/);
  });

  it("stops every animation under prefers-reduced-motion", () => {
    expect(html).toContain("animate-brand-draw motion-reduce:animate-none");
    expect(html).toContain("animate-brand-settle motion-reduce:animate-none");
  });

  it("rests on the finished mark: no static dash offset or opacity holds it hidden", () => {
    expect(html).not.toContain("stroke-dashoffset");
    expect(html).not.toMatch(/<rect [^>]*opacity/);
  });

  it("gives each instance its own mask id", () => {
    const twice = render(
      createElement("div", null, createElement(BrandMarkReveal), createElement(BrandMarkReveal)),
    );
    const ids = [...twice.matchAll(/<mask id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("brand reveal keyframes", () => {
  it("draws the pen from blank to complete and opens the full mask at the end", () => {
    expect(css).toMatch(/@keyframes brand-draw\s*{\s*from\s*{\s*stroke-dashoffset: 1;\s*}\s*to\s*{\s*stroke-dashoffset: 0;/);
    expect(css).toMatch(/@keyframes brand-settle\s*{\s*0%,\s*93%\s*{\s*opacity: 0;\s*}\s*100%\s*{\s*opacity: 1;/);
  });

  it("holds the blank start through the delay and never loops", () => {
    expect(css).toMatch(/--animate-brand-draw: brand-draw [^;]* both;/);
    expect(css).toMatch(/--animate-brand-settle: brand-settle [^;]* both;/);
    expect(css).not.toMatch(/--animate-brand-(draw|settle):[^;]*infinite/);
  });

  it("completes the mark in about half a second, the settle opening only after the pen finishes", () => {
    const timing = (name: string) => {
      const match = css.match(new RegExp(`--animate-brand-${name}: brand-${name} (\\d+)ms .* (\\d+)ms both;`));
      if (!match) throw new Error(`no --animate-brand-${name}`);
      return { duration: Number(match[1]), delay: Number(match[2]) };
    };
    const draw = timing("draw");
    const settle = timing("settle");
    const penDone = draw.delay + draw.duration;
    const settleOpens = settle.delay + settle.duration * 0.93;
    const markDone = settle.delay + settle.duration;

    expect(settleOpens).toBeGreaterThanOrEqual(penDone);
    expect(markDone).toBeGreaterThanOrEqual(450);
    expect(markDone).toBeLessThanOrEqual(500);
  });
});

describe("RouteLoading", () => {
  const html = render(createElement(RouteLoading));

  it("shows only the mark — no visible loading text", () => {
    const visibleText = html.replace(/<[^>]+>/g, "").trim();
    expect(visibleText).toBe("");
  });

  it("announces a single loading status to assistive tech", () => {
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Loading"');
    expect(html).toContain('aria-busy="true"');
  });

  it("centres the mark in a box the exact height of the content area", () => {
    expect(html).toContain("grid");
    expect(html).toContain("place-items-center");
    expect(html).toContain("min-h-[calc(100svh-4rem-2rem)]");
    expect(html).toContain("sm:min-h-[calc(100svh-4rem-3rem)]");
    expect(html).toContain("lg:min-h-[calc(100svh-4rem-4rem)]");
  });

  it("renders nothing behind the mark — no skeleton, image or photo", () => {
    expect(html).not.toMatch(/<img|background|blur|skeleton/i);
  });

  it("sets the mark on a dark tile in light mode only, so its pale stem stays visible on white", () => {
    expect(html).toMatch(/<span class="[^"]*\bbg-foreground\b[^"]*\bdark:bg-transparent\b[^"]*"><svg/);
  });
});
