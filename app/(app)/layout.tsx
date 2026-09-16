import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { TopNav } from "@/components/shell/topnav";

// Auth is the only thing this layout blocks navigation on — it's a security
// gate, not cosmetic, so it stays a plain await. The profile lookup (avatar,
// display name in TopNav) used to run here too, sequentially after this,
// adding a second blocking network round trip to every navigation between
// sibling routes under (app)/ with no loading state to show for it (this
// layout has no loading.tsx of its own, and per Next's docs a route
// segment's loading.tsx never covers its own layout.tsx's data fetching —
// only app/(app)/loading.tsx's fallback for `children` applies). It now
// streams in independently via components/shell/topnav.tsx's Suspense
// boundary instead of gating the whole shell.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-svh bg-background">
      <Sidebar />
      <div className="flex flex-col lg:pl-64">
        <TopNav />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
