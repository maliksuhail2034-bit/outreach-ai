import type { ReactNode } from "react";
import Link from "next/link";
import { LogOutIcon, ShieldCheckIcon, UserCogIcon } from "lucide-react";

import { requireStaffPage } from "@/lib/staff/auth";
import { consoleNavFor } from "@/lib/staff/navigation";
import { STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import { staffSignOutAction } from "@/app/console/session-actions";
import { ConsoleMobileNav, ConsoleNav } from "@/components/console/console-nav";
import { ConsolePresence } from "@/components/console/console-presence";
import { PolimatiqLogo } from "@/components/shell/polimatiq-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

// Every page under (panel) needs a verified staff session (role + 2-step
// login). Pages still call requireStaffPage(permission) themselves for their
// own permission — a layout check alone doesn't cover the page's data.
export default async function ConsolePanelLayout({ children }: { children: ReactNode }) {
  const session = await requireStaffPage();
  const items = consoleNavFor(session.role);
  const roleLabel = STAFF_ROLE_LABELS[session.role];

  return (
    <div className="min-h-svh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-5">
          <PolimatiqLogo width={110} />
          <Badge variant="outline" className="gap-1">
            <ShieldCheckIcon className="size-3" aria-hidden="true" />
            Staff
          </Badge>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <ConsoleNav items={items} />
        </div>
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            >
              {initials(session.staff.display_name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{session.staff.display_name}</p>
              <p className="truncate text-xs text-sidebar-foreground/60">{roleLabel}</p>
            </div>
            <Button asChild variant="ghost" size="icon" title="Your account">
              <Link href="/console/account" aria-label="Your account: password and username">
                <UserCogIcon className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <form action={staffSignOutAction}>
              <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
                <LogOutIcon className="size-4" aria-hidden="true" />
              </Button>
            </form>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 shadow-sm backdrop-blur lg:hidden">
        <div className="flex items-center gap-1">
          <ConsoleMobileNav items={items} />
          <PolimatiqLogo width={96} />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <ShieldCheckIcon className="size-3" aria-hidden="true" />
            {roleLabel}
          </Badge>
          <Button asChild variant="ghost" size="icon" title="Your account">
            <Link href="/console/account" aria-label="Your account: password and username">
              <UserCogIcon className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <form action={staffSignOutAction}>
            <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
              <LogOutIcon className="size-4" aria-hidden="true" />
            </Button>
          </form>
        </div>
      </header>

      <ConsolePresence />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
