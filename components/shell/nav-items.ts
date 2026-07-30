import {
  BarChart3Icon,
  LayoutDashboardIcon,
  MailIcon,
  MegaphoneIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

// Only real, working destinations. Outreach features (leads, campaigns,
// etc.) get added here once they exist — see CLAUDE.md, don't add
// placeholder links to routes that don't exist yet.
export const navItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { title: "Leads", href: "/leads", icon: UsersIcon },
  { title: "Campaigns", href: "/campaigns", icon: MegaphoneIcon },
  { title: "Mailboxes", href: "/mailboxes", icon: MailIcon },
  { title: "Analytics", href: "/analytics", icon: BarChart3Icon },
  { title: "Settings", href: "/settings", icon: SettingsIcon },
];
