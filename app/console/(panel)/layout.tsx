import type { ReactNode } from "react";
import { LogOutIcon, ShieldCheckIcon } from "lucide-react";

import { requireStaffPage } from "@/lib/staff/auth";
import { consoleNavFor } from "@/lib/staff/navigation";
import { STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import { signOut } from "@/lib/actions/auth";
import { ConsoleNav } from "@/components/console/console-nav";
import { PolimatiqLogo } from "@/components/shell/polimatiq-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Every page under (panel) needs a verified staff session (role + 2-step
// login). Pages still call requireStaffPage(permission) themselves for their
// own permission — a layout check alone doesn't cover the page's data.
export default async function ConsolePanelLayout({ children }: { children: ReactNode }) {
  const session = await requireStaffPage();
  const items = consoleNavFor(session.role);

  return (
    <div className="lg:flex">
      <aside className="border-b border-border bg-card lg:fixed lg:inset-y-0 lg:w-64 lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center justify-between gap-2 border-b border-border px-4 lg:px-6">
          <PolimatiqLogo width={110} />
          <Badge variant="outline" className="gap-1">
            <ShieldCheckIcon className="size-3" aria-hidden="true" />
            Staff
          </Badge>
        </div>
        <div className="px-3 py-4">
          <ConsoleNav items={items} />
        </div>
      </aside>
      <div className="flex-1 lg:pl-64">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-border px-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{session.staff.display_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {STAFF_ROLE_LABELS[session.role]} · {session.user.email}
            </p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              <LogOutIcon aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </header>
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
