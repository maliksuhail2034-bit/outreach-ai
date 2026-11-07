"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { updateVerifiedLeadStatus } from "@/lib/db";
import { requireStaffAction } from "@/lib/staff/auth";
import { recordStaffAction } from "@/lib/staff/audit";
import { runStaffAction, StaffInputError } from "@/lib/staff/run-action";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit/check-rate-limit";
import { importVerifiedLeads } from "@/lib/verified-leads/upload";
import { MAX_UPLOAD_BYTES } from "@/lib/verified-leads/parse";

const uploadMetaSchema = z.object({
  source: z.string().trim().min(2, { message: "Say where these leads came from (e.g. “Apollo export, Nov 2026”)." }).max(200),
  verifiedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Pick the verification date." })
    .transform((value) => `${value}T12:00:00.000Z`),
});

const ALLOWED_EXTENSIONS = [".csv", ".tsv", ".txt"];

export async function uploadVerifiedLeadsAction(formData: FormData) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("leads:manage");
    const meta = uploadMetaSchema.parse({ source: formData.get("source"), verifiedAt: formData.get("verifiedAt") });

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new StaffInputError("Choose a file to upload.");
    if (!ALLOWED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
      throw new StaffInputError("Upload a .csv or .tsv file. From Excel or Google Sheets, use File → Save as / Download → CSV.");
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new StaffInputError("That file is over 5 MB. Split it and upload the parts.");

    try {
      await checkRateLimit("staff:lead_upload", session.user.id);
    } catch (error) {
      if (error instanceof RateLimitError) throw new StaffInputError(error.message);
      throw error;
    }

    const result = await importVerifiedLeads(createAdminClient(), {
      text: await file.text(),
      fileName: file.name,
      source: meta.source,
      verifiedAt: meta.verifiedAt,
      uploadedBy: session.user.id,
    });
    if ("error" in result) throw new StaffInputError(result.error);

    await recordStaffAction(session, "leads.uploaded", {
      targetType: "verified_lead_batch",
      targetId: result.batchId ?? undefined,
      metadata: {
        rows: result.totalRows,
        inserted: result.inserted,
        already_in_pool: result.alreadyInPool,
        duplicates_in_file: result.duplicatesInFile,
        suppressed: result.suppressed,
        rejected: result.rejected.length,
      },
    });
    revalidatePath("/console/sales");
    return { ...result, rejected: result.rejected.slice(0, 50) };
  });
}

const statusChangeSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: z.enum(["active", "retired", "suppressed"]),
});

// Retire: stop delivering it (keeps existing deliveries working).
// Suppress: the person objected — out of every future delivery and every
// pending send to it. Reactivate only from "retired".
export async function setVerifiedLeadStatusAction(ids: string[], status: "active" | "retired" | "suppressed") {
  return runStaffAction(async () => {
    const session = await requireStaffAction("leads:manage");
    const parsed = statusChangeSchema.parse({ ids, status });
    const changed = await updateVerifiedLeadStatus(createAdminClient(), parsed.ids, parsed.status, "staff_global_opt_out");
    await recordStaffAction(session, `leads.status_${parsed.status}`, {
      targetType: "verified_lead",
      metadata: { count: changed, ids: parsed.ids.slice(0, 50) },
    });
    revalidatePath("/console/sales");
    return { changed };
  });
}
