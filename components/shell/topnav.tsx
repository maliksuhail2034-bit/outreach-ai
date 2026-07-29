import { MobileNav } from "./mobile-nav";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { UserMenu } from "./user-menu";

export function TopNav({
  email,
  displayName,
  initials,
  avatarUrl,
}: {
  email: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-sm sm:px-6">
      <MobileNav />
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <UserMenu email={email} displayName={displayName} initials={initials} avatarUrl={avatarUrl} />
      </div>
    </header>
  );
}
