import type { StaffRole } from "@/lib/db/staff";

// The staff permission model in one place. Pure (no I/O) so it's unit-tested
// directly and shared by the console's navigation, pages and Server
// Functions — a permission check is never re-derived ad hoc at a call site.

export type StaffPermission =
  | "console:overview"
  | "customers:view"
  | "billing:view"
  | "quotas:edit"
  | "allocation:run"
  | "staff:view"
  | "staff:manage"
  | "security:view"
  | "security:act"
  | "audit:view"
  | "grc:edit"
  | "leads:view"
  | "leads:manage";

const OWNER: readonly StaffPermission[] = [
  "console:overview",
  "customers:view",
  "billing:view",
  "quotas:edit",
  "allocation:run",
  "staff:view",
  "staff:manage",
  "security:view",
  "security:act",
  "audit:view",
  "grc:edit",
  "leads:view",
  "leads:manage",
];

// Security sees everything security-related, including every user and the
// customer list, and can act on accounts and IPs — but cannot change plan
// quotas, billing, or run allocations.
const SECURITY: readonly StaffPermission[] = [
  "console:overview",
  "customers:view",
  "staff:view",
  "staff:manage",
  "security:view",
  "security:act",
  "audit:view",
  "grc:edit",
  "leads:view",
];

const SALES: readonly StaffPermission[] = ["console:overview", "leads:view", "leads:manage"];

const PERMISSIONS: Record<StaffRole, ReadonlySet<StaffPermission>> = {
  owner: new Set(OWNER),
  security: new Set(SECURITY),
  sales: new Set(SALES),
};

export function hasStaffPermission(role: StaffRole, permission: StaffPermission): boolean {
  return PERMISSIONS[role].has(permission);
}

// Which roles a staff member of `actorRole` may create, change into, or
// disable. Only an owner can grant or touch the owner role; security can
// manage security and sales staff; sales manages no one.
export function manageableRoles(actorRole: StaffRole): readonly StaffRole[] {
  if (actorRole === "owner") return ["owner", "security", "sales"];
  if (actorRole === "security") return ["security", "sales"];
  return [];
}

export function canManageStaffRole(actorRole: StaffRole, targetRole: StaffRole): boolean {
  return manageableRoles(actorRole).includes(targetRole);
}

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  security: "Security",
  sales: "Sales",
};

export function isStaffRole(value: unknown): value is StaffRole {
  return value === "owner" || value === "security" || value === "sales";
}
