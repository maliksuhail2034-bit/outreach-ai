import type { Json } from "@/types/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertStaffAuditEntry } from "@/lib/db/staff";
import { getClientIp } from "@/lib/rate-limit/get-client-ip";
import { captureError } from "@/lib/monitoring/error-tracking";
import { errorMessage } from "@/lib/monitoring/error-message";
import type { StaffSession } from "./auth";

// Records a staff action in the append-only staff_audit_log. Called after
// the action succeeds. Metadata must never contain secrets, passwords,
// setup links or full lead lists — ids, counts and reasons only.
//
// A failed audit write never hides itself: it's logged and sent to error
// tracking (the action has already happened, so failing the request would
// only confuse the operator).
export async function recordStaffAction(
  session: Pick<StaffSession, "user" | "role">,
  action: string,
  details: { targetType?: string; targetId?: string; metadata?: Record<string, Json> } = {},
): Promise<void> {
  try {
    await insertStaffAuditEntry(createAdminClient(), {
      actorUserId: session.user.id,
      actorRole: session.role,
      action,
      targetType: details.targetType ?? null,
      targetId: details.targetId ?? null,
      ip: await getClientIp(),
      metadata: details.metadata ?? {},
    });
  } catch (error) {
    const message = errorMessage(error, "Unknown error writing the staff audit log.");
    console.error("[staff-audit] write failed", { action, error: message });
    await captureError({ job: "staff-console", message: `Staff audit write failed for ${action}: ${message}`, context: { action } });
  }
}
