import type { User } from "@supabase/supabase-js";
import type { Tables } from "@/types/database.types";
import { TIMEZONES } from "@/lib/timezones";

function metadataString(user: User, key: string, maxLength: number): string | null {
  const value: unknown = user.user_metadata?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

// What the user entered at sign-up (lib/actions/auth.ts's signUp stores it
// as Supabase user_metadata). user_metadata is user-editable through the
// Auth API, so it's treated as untrusted input: type-checked, length-capped
// and, for the timezone, restricted to the same list the Settings picker
// offers.
export function getSignupProfileSeed(user: User): { fullName: string | null; timezone: string | null } {
  const timezone = metadataString(user, "timezone", 64);
  return {
    fullName: metadataString(user, "full_name", 120),
    timezone: timezone && (TIMEZONES as readonly string[]).includes(timezone) ? timezone : null,
  };
}

export function getDisplayName(user: User, profile: Tables<"profiles"> | null) {
  return (
    profile?.full_name?.trim() || getSignupProfileSeed(user).fullName || user.email?.split("@")[0] || "there"
  );
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
