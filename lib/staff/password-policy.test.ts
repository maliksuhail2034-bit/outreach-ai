import { describe, expect, it } from "vitest";

import {
  needsPasswordChange,
  normalizeUsername,
  STAFF_PASSWORD_POLICY_VERSION,
  staffPasswordMinLength,
  staffPasswordProblems,
  staffPasswordRules,
  usernameProblem,
} from "./password-policy";

const STRONG_16 = "Tr4in-Station-91x"; // 17 chars, every class

describe("staff password policy", () => {
  it("requires 16+ characters and a symbol for owner and security", () => {
    for (const role of ["owner", "security"] as const) {
      expect(staffPasswordMinLength(role)).toBe(16);
      expect(staffPasswordRules(role).map((rule) => rule.id)).toEqual(["length", "lowercase", "uppercase", "number", "symbol"]);
      expect(staffPasswordProblems(role, STRONG_16)).toEqual([]);
      expect(staffPasswordProblems(role, "Short-pass1")).toContain("Must be at least 16 characters.");
      expect(staffPasswordProblems(role, "NoSymbolsHere12345")).toContain("Include a symbol.");
    }
  });

  it("requires 12+ characters for sales, no symbol", () => {
    expect(staffPasswordMinLength("sales")).toBe(12);
    expect(staffPasswordProblems("sales", "SalesTeam2026")).toEqual([]);
    expect(staffPasswordProblems("sales", "Sales2026")).toContain("Must be at least 12 characters.");
  });

  it("keeps the customer rules (lowercase, uppercase, number)", () => {
    const problems = staffPasswordProblems("owner", "all-lowercase-and-long!");
    expect(problems).toContain("Include an uppercase letter.");
    expect(problems).toContain("Include a number.");
  });

  it("rejects passwords containing the username or email name, or long repeats", () => {
    expect(staffPasswordProblems("owner", "Malik.Suhail-2026!xyz", { username: "malik.suhail" })).toContain(
      "Don't include your username or email in the password.",
    );
    expect(staffPasswordProblems("owner", "Jane-Doe-Secure-2026!", { email: "jane-doe@acme.com" })).toContain(
      "Don't include your username or email in the password.",
    );
    expect(staffPasswordProblems("owner", "Aaaaaaaa-Secure-2026!")).toContain("Don't repeat the same character six or more times.");
  });

  it("caps the length at bcrypt's limit", () => {
    expect(staffPasswordProblems("owner", `${STRONG_16}${"x".repeat(80)}`)).toContain("Must be at most 72 characters.");
  });
});

describe("needsPasswordChange", () => {
  const base = { password_must_change: false, password_policy_version: STAFF_PASSWORD_POLICY_VERSION };

  it("asks owner and security accounts set before the policy for a new password", () => {
    expect(needsPasswordChange({ ...base, role: "owner", password_policy_version: 0 })).toBe(true);
    expect(needsPasswordChange({ ...base, role: "security", password_policy_version: 0 })).toBe(true);
    expect(needsPasswordChange({ ...base, role: "sales", password_policy_version: 0 })).toBe(false);
  });

  it("asks anyone whose password an administrator set", () => {
    expect(needsPasswordChange({ ...base, role: "sales", password_must_change: true })).toBe(true);
  });

  it("lets compliant accounts through", () => {
    expect(needsPasswordChange({ ...base, role: "owner" })).toBe(false);
  });
});

describe("usernames", () => {
  it("accepts 3-32 lowercase letters, numbers, dots, dashes, underscores", () => {
    expect(usernameProblem("malik.suhail")).toBeNull();
    expect(usernameProblem("ops_team-2")).toBeNull();
    expect(usernameProblem("  Malik.Suhail  ")).toBeNull();
    expect(normalizeUsername("  Malik.Suhail ")).toBe("malik.suhail");
  });

  it("refuses email addresses, too short or long, and bad characters", () => {
    expect(usernameProblem("jane@acme.com")).toBe("A username can't be an email address.");
    expect(usernameProblem("ab")).not.toBeNull();
    expect(usernameProblem("a".repeat(33))).not.toBeNull();
    expect(usernameProblem(".leading-dot")).not.toBeNull();
    expect(usernameProblem("has space")).not.toBeNull();
  });
});
