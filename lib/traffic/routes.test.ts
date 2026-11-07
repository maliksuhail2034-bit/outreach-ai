import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { COUNTED_ROUTES, isCountedRoute } from "./routes";

// Every page route in app/, as a URL pattern (route groups removed).
function appPageRoutes(): string[] {
  const root = join(process.cwd(), "app");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") {
        const segments = relative(root, dir)
          .split(sep)
          .filter((segment) => segment && !/^\(.*\)$/.test(segment));
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(root);
  return routes;
}

describe("COUNTED_ROUTES", () => {
  it("lists exactly the app's pages, minus the staff console", () => {
    const expected = appPageRoutes()
      .filter((route) => route !== "/console" && !route.startsWith("/console/"))
      .sort();
    // If this fails, a page was added or removed: update lib/traffic/routes.ts.
    expect([...COUNTED_ROUTES].sort()).toEqual(expected);
  });
});

describe("isCountedRoute", () => {
  it("counts real pages, including dynamic ones and a trailing slash", () => {
    expect(isCountedRoute("/")).toBe(true);
    expect(isCountedRoute("/signup")).toBe(true);
    expect(isCountedRoute("/privacy/")).toBe(true);
    expect(isCountedRoute("/leads/0b3c7a3e-7a2f-4f0e-9a51-0d7f3c2b1a9e")).toBe(true);
    expect(isCountedRoute("/campaigns/42/analytics")).toBe(true);
    expect(isCountedRoute("/unsubscribe/abcDEF1234567890abcdef12")).toBe(true);
  });

  it("ignores pages that don't exist and bot probes", () => {
    for (const path of ["/pricing", "/wp-admin", "/wp-login.php", "/.env", "/admin", "/leads/1/edit", "/campaigns/42/analytics/x", "//"]) {
      expect(isCountedRoute(path)).toBe(false);
    }
  });
});
