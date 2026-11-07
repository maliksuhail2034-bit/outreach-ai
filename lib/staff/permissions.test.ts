import { describe, expect, it } from "vitest";

import { consoleNavFor } from "./navigation";
import { canManageStaffRole, hasStaffPermission, isStaffRole, manageableRoles } from "./permissions";

describe("staff permissions", () => {
  it("gives owners everything", () => {
    for (const permission of ["quotas:edit", "allocation:run", "billing:view", "traffic:view", "staff:manage", "leads:manage"] as const) {
      expect(hasStaffPermission("owner", permission)).toBe(true);
    }
  });

  it("lets security see traffic, customers and security, but not billing, quotas or allocation", () => {
    expect(hasStaffPermission("security", "traffic:view")).toBe(true);
    expect(hasStaffPermission("security", "customers:view")).toBe(true);
    expect(hasStaffPermission("security", "security:act")).toBe(true);
    expect(hasStaffPermission("security", "billing:view")).toBe(false);
    expect(hasStaffPermission("security", "quotas:edit")).toBe(false);
    expect(hasStaffPermission("security", "allocation:run")).toBe(false);
  });

  it("limits sales to the lead pool", () => {
    expect(hasStaffPermission("sales", "leads:manage")).toBe(true);
    for (const permission of ["traffic:view", "customers:view", "security:view", "staff:view", "billing:view"] as const) {
      expect(hasStaffPermission("sales", permission)).toBe(false);
    }
  });

  it("only lets an owner grant or touch the owner role", () => {
    expect(manageableRoles("owner")).toEqual(["owner", "security", "sales"]);
    expect(canManageStaffRole("security", "owner")).toBe(false);
    expect(canManageStaffRole("security", "sales")).toBe(true);
    expect(manageableRoles("sales")).toEqual([]);
  });

  it("recognises only real roles", () => {
    expect(isStaffRole("owner")).toBe(true);
    expect(isStaffRole("admin")).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});

describe("console navigation", () => {
  it("shows each role only the pages it may open", () => {
    const hrefs = (role: "owner" | "security" | "sales") => consoleNavFor(role).map((item) => item.href);
    expect(hrefs("owner")).toContain("/console/traffic");
    expect(hrefs("owner")).toContain("/console/lead-program");
    expect(hrefs("security")).toContain("/console/traffic");
    expect(hrefs("security")).not.toContain("/console/lead-program");
    expect(hrefs("sales")).toEqual(["/console", "/console/sales", "/console/sales/upload"]);
  });
});
