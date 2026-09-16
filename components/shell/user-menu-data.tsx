import { getUser, getCachedProfile } from "@/lib/supabase/auth";
import { getDisplayName, getInitials } from "@/lib/user";
import { UserMenu } from "./user-menu";

// Split out from app/(app)/layout.tsx so the profile lookup (avatar, display
// name — cosmetic, not needed to authorize the request) can stream in behind
// its own <Suspense> boundary in components/shell/topnav.tsx instead of
// blocking the whole authenticated shell on a second sequential network
// round trip after the auth check. getUser()/getCachedProfile() are both
// request-scoped via React cache(), so this reuses the same lookups
// app/(app)/layout.tsx and the page already made instead of repeating them.
export async function UserMenuData() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this renders; this narrows the type for what follows.
  if (!user) return null;

  const profile = await getCachedProfile(user.id);
  const displayName = getDisplayName(user, profile);

  return (
    <UserMenu
      email={user.email ?? ""}
      displayName={displayName}
      initials={getInitials(displayName)}
      avatarUrl={profile?.avatar_url ?? null}
    />
  );
}
