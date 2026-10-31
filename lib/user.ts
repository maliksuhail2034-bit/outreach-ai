import type { User } from "@supabase/supabase-js";
import type { Tables } from "@/types/database.types";

// Signup stores the name in auth user metadata; the profiles row is only
// written once the user saves Settings, so fall back to the metadata.
export function getFullName(user: User, profile: Tables<"profiles"> | null) {
  const signupName: unknown = user.user_metadata?.full_name;
  return profile?.full_name?.trim() || (typeof signupName === "string" ? signupName.trim() : "");
}

export function getDisplayName(user: User, profile: Tables<"profiles"> | null) {
  return getFullName(user, profile) || user.email?.split("@")[0] || "there";
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
