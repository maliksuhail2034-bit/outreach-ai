import type { User } from "@supabase/supabase-js";
import type { Tables } from "@/types/database.types";

export function getDisplayName(user: User, profile: Tables<"profiles"> | null) {
  return profile?.full_name?.trim() || user.email?.split("@")[0] || "there";
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
