import { afterEach, describe, expect, it, vi } from "vitest";

import { appOrigin, appUrl, AppUrlConfigError } from "./app-url";

afterEach(() => vi.unstubAllEnvs());

describe("appUrl", () => {
  it("builds URLs on the configured public origin, keeping path and query", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.polimatiq.example");
    expect(appUrl("/mailboxes?connected=gmail").href).toBe("https://app.polimatiq.example/mailboxes?connected=gmail");
  });

  it("ignores any path or trailing slash on NEXT_PUBLIC_APP_URL, using only its origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.polimatiq.example/some/base/");
    expect(appOrigin()).toBe("https://app.polimatiq.example");
    expect(appUrl("/login").href).toBe("https://app.polimatiq.example/login");
  });

  it.each(["//evil.example/x", "/\\evil.example", "https://evil.example", "mailboxes", ""])(
    "refuses %j so it can never become an open redirect",
    (path) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.polimatiq.example");
      expect(() => appUrl(path)).toThrow();
    },
  );

  it.each([
    ["unset", ""],
    ["not a URL", "polimatiq.example"],
    ["not http(s)", "javascript:alert(1)"],
  ])("fails closed when NEXT_PUBLIC_APP_URL is %s", (_label, value) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
    expect(() => appUrl("/login")).toThrow(AppUrlConfigError);
  });
});
