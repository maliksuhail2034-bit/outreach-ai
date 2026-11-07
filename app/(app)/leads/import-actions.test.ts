import { beforeEach, describe, expect, it, vi } from "vitest";

const existingLeads = vi.hoisted(() => ({ rows: [] as { email: string }[] }));
const leadLists = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn(async () => ({ id: "user-1", email: "owner@example.com" })) }));
vi.mock("@/lib/supabase/server", () => ({
  // Only the lead_lists ownership check reads through the client directly.
  createClient: vi.fn(async () => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      maybeSingle: async () => ({
        data: leadLists.ids.includes(filters.id as string) ? { id: filters.id } : null,
        error: null,
      }),
    };
    return { from: () => chain };
  }),
}));
vi.mock("@/lib/db", () => ({
  createLeadsBatch: vi.fn(async (_supabase: unknown, values: unknown[]) => ({ created: values, failedIndexes: [] })),
  getUserOrganization: vi.fn(async () => ({ id: "org-1" })),
  listExistingLeadEmails: vi.fn(
    async (_supabase: unknown, _userId: string, emails: string[]) =>
      new Set(existingLeads.rows.map((row) => row.email).filter((email) => emails.includes(email))),
  ),
}));
vi.mock("@/lib/billing/limits", () => ({ getRemainingLeadQuota: vi.fn(async () => 1000) }));
vi.mock("@/lib/rate-limit/check-rate-limit", () => ({
  checkRateLimit: vi.fn(),
  RateLimitError: class RateLimitError extends Error {},
}));

import { createLeadsBatch, listExistingLeadEmails } from "@/lib/db";
import { importLeadsAction } from "./import-actions";

const mockCreateLeadsBatch = vi.mocked(createLeadsBatch);
const mockListExistingLeadEmails = vi.mocked(listExistingLeadEmails);

function csvForm(csv: string, listId?: string) {
  const formData = new FormData();
  formData.set("file", new File([csv], "leads.csv", { type: "text/csv" }));
  if (listId !== undefined) formData.set("listId", listId);
  return formData;
}

function importedTimezones() {
  const values = mockCreateLeadsBatch.mock.calls[0][1] as { email: string; timezone: string | null }[];
  return Object.fromEntries(values.map((lead) => [lead.email, lead.timezone]));
}

beforeEach(() => {
  vi.clearAllMocks();
  existingLeads.rows = [];
  leadLists.ids = [];
});

describe("importLeadsAction — timezone column", () => {
  it("imports a valid timezone from a 'timezone' column", async () => {
    const result = await importLeadsAction(undefined, csvForm("email,timezone\nny@acme.com,America/New_York\n"));

    expect(importedTimezones()).toEqual({ "ny@acme.com": "America/New_York" });
    expect(result).toMatchObject({ imported: 1, failed: 0, warnings: 0, warningRows: [] });
  });

  it("accepts the 'time_zone' and 'Time Zone' header spellings", async () => {
    await importLeadsAction(undefined, csvForm("email,time_zone\ntokyo@acme.com,Asia/Tokyo\n"));
    await importLeadsAction(undefined, csvForm("email,Time Zone\nberlin@acme.com,Europe/Berlin\n"));

    expect(mockCreateLeadsBatch.mock.calls[0][1]).toEqual([expect.objectContaining({ timezone: "Asia/Tokyo" })]);
    expect(mockCreateLeadsBatch.mock.calls[1][1]).toEqual([expect.objectContaining({ timezone: "Europe/Berlin" })]);
  });

  it("imports a row with an invalid timezone, leaves it unset and reports a warning", async () => {
    const result = await importLeadsAction(
      undefined,
      csvForm("email,timezone\nok@acme.com,Europe/London\nbad@acme.com,Mars/Olympus_Mons\n"),
    );

    expect(importedTimezones()).toEqual({ "ok@acme.com": "Europe/London", "bad@acme.com": null });
    expect(result).toMatchObject({ imported: 2, failed: 0, warnings: 1 });
    expect(result?.warningRows).toEqual([
      { row: 3, reason: 'Unknown timezone "Mars/Olympus_Mons" — left unset, the campaign timezone will be used.' },
    ]);
  });

  it("leaves the timezone unset when the column is blank or missing", async () => {
    await importLeadsAction(undefined, csvForm("email,timezone\nblank@acme.com,\n"));
    await importLeadsAction(undefined, csvForm("email,company\nnone@acme.com,Acme\n"));

    expect(mockCreateLeadsBatch.mock.calls[0][1]).toEqual([expect.objectContaining({ timezone: null })]);
    expect(mockCreateLeadsBatch.mock.calls[1][1]).toEqual([expect.objectContaining({ timezone: null })]);
  });
});

describe("importLeadsAction — dedup and list", () => {
  // The dedup set used to be the user's whole lead table in one request,
  // capped at PostgREST's max_rows (1000): past that, existing emails were
  // missed and reported as failed rows instead of skipped duplicates.
  it("looks up only this CSV's (lowercased, valid) emails and skips the ones that exist", async () => {
    existingLeads.rows = [{ email: "old@acme.com" }];

    const result = await importLeadsAction(
      undefined,
      csvForm("email\nOLD@acme.com\nnew@acme.com\nnot-an-email\nnew@acme.com\n"),
    );

    expect(mockListExistingLeadEmails).toHaveBeenCalledWith(expect.anything(), "user-1", [
      "old@acme.com",
      "new@acme.com",
      "new@acme.com",
    ]);
    expect(mockCreateLeadsBatch.mock.calls[0][1]).toEqual([expect.objectContaining({ email: "new@acme.com" })]);
    expect(result).toMatchObject({ imported: 1, skippedDuplicates: 2, failed: 1 });
  });

  it("rejects a list id that isn't a uuid without importing anything", async () => {
    const result = await importLeadsAction(undefined, csvForm("email\na@acme.com\n", "not-a-uuid"));

    expect(result).toMatchObject({ error: "Choose a valid list.", imported: 0 });
    expect(mockCreateLeadsBatch).not.toHaveBeenCalled();
  });

  it("rejects a list that no longer exists without importing anything", async () => {
    const result = await importLeadsAction(
      undefined,
      csvForm("email\na@acme.com\n", "11111111-1111-4111-8111-111111111111"),
    );

    expect(result?.error).toMatch(/no longer exists/);
    expect(mockCreateLeadsBatch).not.toHaveBeenCalled();
  });

  it("imports into a list the user owns", async () => {
    leadLists.ids = ["11111111-1111-4111-8111-111111111111"];

    await importLeadsAction(undefined, csvForm("email\na@acme.com\n", "11111111-1111-4111-8111-111111111111"));

    expect(mockCreateLeadsBatch.mock.calls[0][1]).toEqual([
      expect.objectContaining({ list_id: "11111111-1111-4111-8111-111111111111" }),
    ]);
  });
});
