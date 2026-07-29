import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db";
import { getDisplayName, getInitials } from "@/lib/user";
import { Sidebar } from "@/components/shell/sidebar";
import { TopNav } from "@/components/shell/topnav";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const profile = await getProfile(supabase, user.id);
  const displayName = getDisplayName(user, profile);

  return (
    <div className="min-h-svh bg-background">
      <Sidebar />
      <div className="flex flex-col lg:pl-64">
        <TopNav
          email={user.email ?? ""}
          displayName={displayName}
          initials={getInitials(displayName)}
          avatarUrl={profile?.avatar_url ?? null}
        />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
