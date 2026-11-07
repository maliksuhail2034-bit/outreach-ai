"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SECURITY_TABS } from "@/lib/staff/navigation";
import { cn } from "@/lib/utils";

export function SecurityTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Security center" className="-mx-1 flex gap-1 relative overflow-x-auto border-b border-border pb-px">
      {SECURITY_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-t-md border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.title}
          </Link>
        );
      })}
    </nav>
  );
}
