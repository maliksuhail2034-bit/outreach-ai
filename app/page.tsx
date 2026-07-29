import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";

export default async function RootPage() {
  const user = await getUser();
  redirect(user ? "/dashboard" : "/login");
}
