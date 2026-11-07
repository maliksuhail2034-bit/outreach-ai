"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BuildingIcon,
  DatabaseIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  MenuIcon,
  ShieldIcon,
  SparklesIcon,
  UploadIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import type { ConsoleNavItem } from "@/lib/staff/navigation";
import { PolimatiqLogo } from "@/components/shell/polimatiq-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ICONS: Record<ConsoleNavItem["icon"], LucideIcon> = {
  overview: LayoutDashboardIcon,
  customers: BuildingIcon,
  traffic: GlobeIcon,
  leadProgram: SparklesIcon,
  staff: UsersIcon,
  security: ShieldIcon,
  pool: DatabaseIcon,
  upload: UploadIcon,
};

const GROUPS = ["Company", "Security", "Sales"] as const;

function isActive(pathname: string, href: string) {
  if (href === "/console") return pathname === "/console";
  // "Lead pool" (/console/sales) must not light up on its own sub-page
  // "Upload leads" (/console/sales/upload), which has its own entry.
  if (href === "/console/sales") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ConsoleNav({ items, onNavigate }: { items: ConsoleNavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Staff console" className="flex flex-col gap-6">
      {GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <p className="px-3 text-[11px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">{group}</p>
            <ul className="mt-2 flex flex-col gap-0.5">
              {groupItems.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
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

export function ConsoleMobileNav({ items }: { items: ConsoleNavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open console menu">
          <MenuIcon className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground">
        <SheetHeader className="border-b border-sidebar-border">
          <SheetTitle className="flex items-center text-left">
            <PolimatiqLogo width={110} />
          </SheetTitle>
          <SheetDescription className="sr-only">Staff console navigation</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto p-3">
          <ConsoleNav items={items} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
