"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { navItems } from "./nav-items";
import { PolimatiqLogo } from "./polimatiq-logo";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 z-40 hidden w-64 flex-col border-r border-nav-border bg-nav text-nav-foreground lg:flex">
      <div className="flex h-16 items-center border-b border-nav-border px-6">
        <PolimatiqLogo width={120} onDark />
      </div>
      <nav className="flex flex-1 flex-col gap-1.5 px-3 py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                isActive
                  ? "text-primary-foreground"
                  : "text-nav-muted-foreground hover:bg-nav-accent hover:text-nav-accent-foreground",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-pill"
                  className="absolute inset-0 rounded-md bg-primary shadow-md shadow-primary/30"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-3 transition-transform duration-150 group-hover:translate-x-0.5">
                <Icon className="size-4" />
                {item.title}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
