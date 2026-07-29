import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (user) {
    redirect("/dashboard");
  }

  return <AuthShell>{children}</AuthShell>;
}
