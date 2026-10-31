import type { Client } from "./shared";

export type UserSession = {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  userAgent: string | null;
  isCurrent: boolean;
};

// The caller's own unexpired sessions, current one first. Scoped to
// auth.uid() inside the function (supabase/migrations/20261031100000_user_sessions.sql).
export async function listMySessions(supabase: Client): Promise<UserSession[]> {
  const { data, error } = await supabase.rpc("list_my_sessions");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    // Generated types mark returned columns non-null; auth.sessions.user_agent isn't.
    userAgent: row.user_agent ?? null,
    isCurrent: row.is_current,
  }));
}

// False when the session doesn't exist or isn't the caller's.
export async function revokeMySession(supabase: Client, sessionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("revoke_my_session", { p_session_id: sessionId });
  if (error) throw error;
  return data;
}
