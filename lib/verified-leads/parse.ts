import Papa from "papaparse";
import { z } from "zod";

// Parses a staff lead upload (CSV / TSV / semicolon-separated — whatever
// "Save as CSV" in Excel, Google Sheets or Numbers produces) into pool rows.
// Pure: no I/O, so it is unit-tested directly. Database-level checks (already
// in the pool, globally suppressed) happen in the upload Server Function.

export const MAX_UPLOAD_ROWS = 10_000;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface ParsedVerifiedLead {
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  website: string | null;
  linkedin: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  industry: string | null;
  source: string;
  verified_at: string;
}

export interface ParseResult {
  rows: ParsedVerifiedLead[];
  rejected: { row: number; reason: string }[];
  duplicatesInFile: number;
  totalRows: number;
  error?: string;
}

const FIELD_ALIASES: Record<keyof ParsedVerifiedLead, string[]> = {
  email: ["email", "e-mail", "email address", "e-mail address", "work email", "business email"],
  first_name: ["first name", "firstname", "first_name", "given name"],
  last_name: ["last name", "lastname", "last_name", "surname", "family name"],
  company: ["company", "company name", "organization", "organisation", "account", "account name"],
  title: ["title", "job title", "position", "role", "designation"],
  website: ["website", "company website", "domain", "url", "web"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile", "person linkedin url"],
  phone: ["phone", "phone number", "mobile", "telephone"],
  city: ["city", "town"],
  country: ["country", "country code"],
  industry: ["industry", "sector", "vertical"],
  source: ["source", "lead source", "data source"],
  verified_at: ["verified at", "verified_at", "verified on", "verification date", "verified date"],
};

function normalizeHeader(header: string): string {
  return header.replace(/^﻿/, "").trim().toLowerCase().replace(/[_\s]+/g, " ");
}

export function mapHeaders(headers: string[]): Partial<Record<keyof ParsedVerifiedLead, string>> {
  const mapping: Partial<Record<keyof ParsedVerifiedLead, string>> = {};
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [keyof ParsedVerifiedLead, string[]][]) {
      if (!mapping[field] && aliases.map((alias) => alias.replace(/_/g, " ")).includes(normalized)) {
        mapping[field] = header;
      }
    }
  }
  return mapping;
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

function clean(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  // Strip control characters and a leading formula trigger (=, +, -, @) so a
  // value can never act as a spreadsheet formula if someone re-exports it.
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/^[=+\-@]+/, "").trim();
  return text ? text.slice(0, max) : null;
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseVerifiedLeadFile(
  text: string,
  defaults: { source: string; verifiedAt: string },
  now: Date = new Date(),
): ParseResult {
  const empty: ParseResult = { rows: [], rejected: [], duplicatesInFile: 0, totalRows: 0 };
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", delimitersToGuess: [",", ";", "\t", "|"] });
  const headers = parsed.meta.fields ?? [];
  const mapping = mapHeaders(headers);
  if (!mapping.email) return { ...empty, error: "No email column found. Name a column “email”." };
  if (parsed.data.length > MAX_UPLOAD_ROWS) {
    return { ...empty, totalRows: parsed.data.length, error: `That file has ${parsed.data.length} rows; the limit is ${MAX_UPLOAD_ROWS} per upload.` };
  }

  const result: ParseResult = { ...empty, totalRows: parsed.data.length };
  const seen = new Set<string>();
  const latestAllowed = now.getTime() + 24 * 60 * 60 * 1000;

  parsed.data.forEach((record, index) => {
    const rowNumber = index + 2; // 1-based, after the header row
    const get = (field: keyof ParsedVerifiedLead, max?: number) => (mapping[field] ? clean(record[mapping[field]!], max) : null);

    const email = emailSchema.safeParse(record[mapping.email!] ?? "");
    if (!email.success) {
      result.rejected.push({ row: rowNumber, reason: "Missing or invalid email address." });
      return;
    }
    if (seen.has(email.data)) {
      result.duplicatesInFile += 1;
      return;
    }
    seen.add(email.data);

    const source = get("source", 200) ?? defaults.source;
    const verifiedAt = parseDate(get("verified_at")) ?? defaults.verifiedAt;
    if (new Date(verifiedAt).getTime() > latestAllowed) {
      result.rejected.push({ row: rowNumber, reason: "Verification date is in the future." });
      return;
    }

    result.rows.push({
      email: email.data,
      first_name: get("first_name", 100),
      last_name: get("last_name", 100),
      company: get("company", 200),
      title: get("title", 200),
      website: get("website", 300),
      linkedin: get("linkedin", 300),
      phone: get("phone", 50),
      city: get("city", 100),
      country: get("country", 100),
      industry: get("industry", 100),
      source,
      verified_at: verifiedAt,
    });
  });

  return result;
}
