import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

// Reads Supabase Auth users for the console (service-role client). Pages
// through the admin API so it works past the first page of users.

const PER_PAGE = 1000;
const MAX_PAGES = 20; // 20,000 users; the console lists, it doesn't export.

export async function listAuthUsers(admin: SupabaseClient<Database>): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < PER_PAGE) break;
  }
  return users;
}

export function isBanned(user: Pick<User, "banned_until">, now: Date = new Date()): boolean {
  return Boolean(user.banned_until && new Date(user.banned_until).getTime() > now.getTime());
}

export function isStaffUser(user: Pick<User, "app_metadata">): boolean {
  return user.app_metadata?.polimatiq_staff === true;
}
