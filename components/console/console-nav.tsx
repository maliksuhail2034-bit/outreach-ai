"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BuildingIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  ShieldIcon,
  SparklesIcon,
  UploadIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import type { ConsoleNavItem } from "@/lib/staff/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<ConsoleNavItem["icon"], LucideIcon> = {
  overview: LayoutDashboardIcon,
  customers: BuildingIcon,
  leadProgram: SparklesIcon,
  staff: UsersIcon,
  security: ShieldIcon,
  pool: DatabaseIcon,
  upload: UploadIcon,
};

export function ConsoleNav({ items }: { items: ConsoleNavItem[] }) {
  const pathname = usePathname();
  const groups = ["Company", "Security", "Sales"] as const;

  return (
    <nav aria-label="Staff console" className="flex flex-col gap-5">
      {groups.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {groupItems.map((item) => {
                const active =
                  item.href === "/console" ? pathname === "/console" : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
