import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import {
  insertVerifiedLeadBatch,
  insertVerifiedLeads,
  listExistingVerifiedEmails,
  listGloballySuppressedEmails,
  updateVerifiedLeadBatch,
} from "@/lib/db";
import { parseVerifiedLeadFile } from "./parse";

export interface UploadSummary {
  batchId: string | null;
  totalRows: number;
  inserted: number;
  alreadyInPool: number;
  duplicatesInFile: number;
  suppressed: number;
  rejected: { row: number; reason: string }[];
}

// Parse -> drop addresses already pooled or that opted out/bounced through
// any customer -> insert as one batch. Service-role client; the caller has
// authorized the staff member (leads:manage).
export async function importVerifiedLeads(
  admin: SupabaseClient<Database>,
  input: { text: string; fileName: string; source: string; verifiedAt: string; uploadedBy: string },
): Promise<UploadSummary | { error: string }> {
  const parsed = parseVerifiedLeadFile(input.text, { source: input.source, verifiedAt: input.verifiedAt });
  if (parsed.error) return { error: parsed.error };

  const emails = parsed.rows.map((row) => row.email);
  const [existing, suppressed] = await Promise.all([
    listExistingVerifiedEmails(admin, emails),
    listGloballySuppressedEmails(admin, emails),
  ]);
  const fresh = parsed.rows.filter((row) => !existing.has(row.email) && !suppressed.has(row.email));
  const suppressedCount = parsed.rows.filter((row) => !existing.has(row.email) && suppressed.has(row.email)).length;

  const summary: UploadSummary = {
    batchId: null,
    totalRows: parsed.totalRows,
    inserted: 0,
    alreadyInPool: parsed.rows.filter((row) => existing.has(row.email)).length,
    duplicatesInFile: parsed.duplicatesInFile,
    suppressed: suppressedCount,
    rejected: parsed.rejected,
  };
  if (fresh.length === 0) return summary;

  const batch = await insertVerifiedLeadBatch(admin, {
    uploaded_by: input.uploadedBy,
    file_name: input.fileName.slice(0, 255) || "upload.csv",
    source: input.source,
    row_count: parsed.totalRows,
  });
  summary.batchId = batch.id;

  summary.inserted = await insertVerifiedLeads(
    admin,
    fresh.map((row) => ({ ...row, batch_id: batch.id, created_by: input.uploadedBy })),
  );
  // Rows that lost a race with a concurrent upload of the same address.
  summary.alreadyInPool += fresh.length - summary.inserted;

  await updateVerifiedLeadBatch(admin, batch.id, {
    inserted_count: summary.inserted,
    duplicate_count: summary.alreadyInPool + summary.duplicatesInFile,
    rejected_count: summary.rejected.length + summary.suppressed,
  });
  return summary;
}
