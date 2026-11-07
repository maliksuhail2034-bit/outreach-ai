import { ZodError } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { StaffAccessError } from "./auth";
import { StaffAccountError } from "./accounts";

// Errors a staff operator should read verbatim are returned, not thrown:
// production builds replace a thrown Server Function message with a generic
// digest. Anything else (a real bug, a database outage) is logged and shown
// generically, never with internal detail.
export class StaffInputError extends Error {}

export async function runStaffAction<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (error instanceof StaffAccessError || error instanceof StaffAccountError || error instanceof StaffInputError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Check the form and try again." };
    }
    console.error("[staff-console] action failed", error);
    return { ok: false, error: "Something went wrong. Try again, and tell the owner if it keeps happening." };
  }
}
