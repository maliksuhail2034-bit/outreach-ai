import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { endStaffWorkSession, touchStaffWorkSession } from "@/lib/db";
import { countryFromHeaders } from "@/lib/billing/region";

// Records staff activity into staff_work_sessions (see
// supabase/migrations/20261109100000_staff_employees.sql). Called on every
// console page load and Server Function, and by the console's in-page
// heartbeat while the person is actively using it. Writes at most once a
// minute per staff member per server process; a failure is logged, never
// shown — time tracking must not block work.

const TOUCH_INTERVAL_MS = 60_000;
const lastTouch = new Map<string, number>();

export async function recordStaffActivity(staffId: string, now: number = Date.now()): Promise<void> {
  const previous = lastTouch.get(staffId);
  if (previous !== undefined && now - previous < TOUCH_INTERVAL_MS) return;
  lastTouch.set(staffId, now);
  try {
    const country = countryFromHeaders(await headers());
    await touchStaffWorkSession(createAdminClient(), staffId, country);
  } catch (error) {
    lastTouch.delete(staffId);
    console.error("[staff-work] activity not recorded", error instanceof Error ? error.message : error);
  }
}

export async function endStaffActivity(staffId: string, reason: "signed_out" | "access_changed" | "idle" = "signed_out"): Promise<void> {
  lastTouch.delete(staffId);
  try {
    await endStaffWorkSession(createAdminClient(), staffId, reason);
  } catch (error) {
    console.error("[staff-work] session not closed", error instanceof Error ? error.message : error);
  }
}

// Test hook.
export function resetActivityThrottle(): void {
  lastTouch.clear();
}
