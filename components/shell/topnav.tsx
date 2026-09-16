import { Suspense } from "react";

import { MobileNav } from "./mobile-nav";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMenuData } from "./user-menu-data";

export function TopNav() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-sm sm:px-6">
      <MobileNav />
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <Suspense fallback={<Skeleton className="size-9 rounded-full" />}>
          <UserMenuData />
        </Suspense>
      </div>
    </header>
  );
}
