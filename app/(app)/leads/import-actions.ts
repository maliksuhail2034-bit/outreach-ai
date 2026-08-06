"use server";

import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createLeadsBatch, getUserOrganization } from "@/lib/db";
import type { TablesInsert } from "@/types/database.types";
import { leadCsvRowSchema } from "@/lib/validations/leads";
import { getRemainingLeadQuota } from "@/lib/billing/limits";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit/check-rate-limit";

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_FAILED_ROWS_SHOWN = 10;

export type ImportLeadsState =
  | undefined
  | {
      error?: string;
      imported: number;
      skippedDuplicates: number;
      failed: number;
      failedRows: { row: number; reason: string }[];
    };

type CsvField = "firstName" | "lastName" | "email" | "company" | "title";

// Accepts a few common header spellings so a spreadsheet export doesn't have
// to be hand-edited before import — not a general mapping UI, just aliases
// for the fixed set of columns this importer understands.
const HEADER_ALIASES: Record<string, CsvField> = {
  first_name: "firstName",
  firstname: "firstName",
  last_name: "lastName",
  lastname: "lastName",
  email: "email",
  company: "company",
  title: "title",
  job_title: "title",
  jobtitle: "title",
};

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeRow(raw: Record<string, string>): Partial<Record<CsvField, string>> {
  const normalized: Partial<Record<CsvField, string>> = {};
  for (const [rawHeader, value] of Object.entries(raw)) {
    const field = HEADER_ALIASES[normalizeHeader(rawHeader)];
    if (field) normalized[field] = value;
  }
  return normalized;
}

export async function importLeadsAction(
  _prevState: ImportLeadsState,
  formData: FormData,
): Promise<ImportLeadsState> {
  const empty = { imported: 0, skippedDuplicates: 0, failed: 0, failedRows: [] as { row: number; reason: string }[] };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: "Choose a CSV file to import." };
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { ...empty, error: "Please upload a .csv file." };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ...empty, error: "That file is too large (max 2 MB). Split it and try again." };
  }

  const listIdRaw = formData.get("listId");
  const listId = typeof listIdRaw === "string" && listIdRaw ? listIdRaw : null;

  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);
  try {
    await checkRateLimit("leads:import", organization.id);
  } catch (error) {
    if (error instanceof RateLimitError) return { ...empty, error: error.message };
    throw error;
  }

  const text = await file.text();
  const { data: rows } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (rows.length === 0) {
    return { ...empty, error: "That CSV has no rows to import." };
  }
  if (rows.length > MAX_ROWS) {
    return { ...empty, error: `That file has too many rows (max ${MAX_ROWS}). Split it and try again.` };
  }

  // Fetched once up front so dedup is a Set lookup per row instead of a
  // query per row — this is what makes correctness (no duplicate leads)
  // cheap to guarantee across the whole batch, including duplicates that
  // only appear within the CSV itself.
  const { data: existingRows, error: existingError } = await supabase
    .from("leads")
    .select("email")
    .eq("user_id", user.id);
  if (existingError) throw existingError;
  const knownEmails = new Set(existingRows.map((row) => row.email.toLowerCase()));
  let remainingQuota = await getRemainingLeadQuota(supabase, user.id, user.email);

  let skippedDuplicates = 0;
  let failed = 0;
  const failedRows: { row: number; reason: string }[] = [];

  // Validation, dedup, and quota are still resolved one row at a time (they're
  // cheap in-memory checks), but the actual insert is deferred: rows that pass
  // become `candidates`, with `rowNumbers` tracking each one's original CSV row
  // number at the same index. That's what lets a batch-insert failure below
  // still be attributed back to the exact row, preserving the same per-row
  // failedRows UX the old sequential-insert loop gave callers.
  const candidates: TablesInsert<"leads">[] = [];
  const rowNumbers: number[] = [];

  for (const [index, rawRow] of rows.entries()) {
    const rowNumber = index + 2; // +1 for 0-index, +1 for the header row
    const parsed = leadCsvRowSchema.safeParse(normalizeRow(rawRow));

    if (!parsed.success) {
      failed += 1;
      if (failedRows.length < MAX_FAILED_ROWS_SHOWN) {
        failedRows.push({ row: rowNumber, reason: parsed.error.issues[0]?.message ?? "Invalid row." });
      }
      continue;
    }

    const email = parsed.data.email.toLowerCase();
    if (knownEmails.has(email)) {
      skippedDuplicates += 1;
      continue;
    }

    if (remainingQuota <= 0) {
      failed += 1;
      if (failedRows.length < MAX_FAILED_ROWS_SHOWN) {
        failedRows.push({ row: rowNumber, reason: "Plan lead limit reached. Upgrade to import more." });
      }
      continue;
    }

    candidates.push({
      user_id: user.id,
      list_id: listId,
      first_name: parsed.data.firstName ? parsed.data.firstName : null,
      last_name: parsed.data.lastName ? parsed.data.lastName : null,
      email,
      company: parsed.data.company ? parsed.data.company : null,
      title: parsed.data.title ? parsed.data.title : null,
    });
    rowNumbers.push(rowNumber);
    // Deliberately reserved optimistically, before this row is actually
    // inserted: a later row in the same CSV needs to be judged against every
    // row already queued for insert, not just ones already confirmed saved,
    // and the batch insert below hasn't run yet at this point in the loop.
    // The tradeoff: if this row's batch insert later fails (rare — schema
    // validation already covers the normal failure modes; the DB-level
    // causes are a concurrent insert of the same email racing this import,
    // or leads_check_list_owner rejecting a list deleted mid-import), a
    // later duplicate of this email elsewhere in the CSV will be wrongly
    // skipped as already-known, and remainingQuota is undercounted by one
    // for the rest of this run. This is safe to accept because the DB's
    // `leads_user_email_key` unique constraint — not this in-memory Set — is
    // the actual authority against duplicate leads, so nothing here can ever
    // let a real duplicate through; it can only be overly conservative. And
    // neither knownEmails nor remainingQuota is persisted: both are
    // recomputed from the database at the start of the next import, so any
    // wrongly-skipped row is simply retryable by re-uploading.
    knownEmails.add(email);
    remainingQuota -= 1;
  }

  const { created, failedIndexes } = await createLeadsBatch(supabase, candidates);

  for (const candidateIndex of failedIndexes) {
    failed += 1;
    if (failedRows.length < MAX_FAILED_ROWS_SHOWN) {
      failedRows.push({ row: rowNumbers[candidateIndex], reason: "Couldn't save this row." });
    }
  }

  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return { imported: created.length, skippedDuplicates, failed, failedRows };
}
