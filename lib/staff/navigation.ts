import type { StaffRole } from "@/lib/db/staff";
import { hasStaffPermission, type StaffPermission } from "./permissions";

export interface ConsoleNavItem {
  href: string;
  title: string;
  icon: "overview" | "customers" | "traffic" | "leadProgram" | "staff" | "security" | "pool" | "upload";
  permission: StaffPermission;
  group: "Company" | "Security" | "Sales";
}

const ITEMS: ConsoleNavItem[] = [
  { href: "/console", title: "Overview", icon: "overview", permission: "console:overview", group: "Company" },
  { href: "/console/customers", title: "Customers", icon: "customers", permission: "customers:view", group: "Company" },
  { href: "/console/traffic", title: "Traffic", icon: "traffic", permission: "traffic:view", group: "Company" },
  { href: "/console/lead-program", title: "Lead program", icon: "leadProgram", permission: "quotas:edit", group: "Company" },
  { href: "/console/staff", title: "Staff accounts", icon: "staff", permission: "staff:view", group: "Company" },
  { href: "/console/security", title: "Security center", icon: "security", permission: "security:view", group: "Security" },
  { href: "/console/sales", title: "Lead pool", icon: "pool", permission: "leads:view", group: "Sales" },
  { href: "/console/sales/upload", title: "Upload leads", icon: "upload", permission: "leads:manage", group: "Sales" },
];

export function consoleNavFor(role: StaffRole): ConsoleNavItem[] {
  return ITEMS.filter((item) => hasStaffPermission(role, item.permission));
}

export const SECURITY_TABS = [
  { href: "/console/security", title: "Alerts" },
  { href: "/console/security/users", title: "Users" },
  { href: "/console/security/sign-ins", title: "Sign-ins & locations" },
  { href: "/console/security/audit", title: "Audit log" },
  { href: "/console/security/ip-blocks", title: "Blocked IPs" },
  { href: "/console/security/grc", title: "GRC" },
  { href: "/console/security/siem", title: "SIEM & network" },
] as const;
