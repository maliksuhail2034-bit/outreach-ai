import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the timezone column's behavior is covered here; the rest of the
// importer (dedup, quota, batch insert) is unchanged by it.
const existingLeads = vi.hoisted(() => ({ rows: [] as { email: string }[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn(async () => ({ id: "user-1", email: "owner@example.com" })) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: existingLeads.rows, error: null }) }) }),
  })),
}));
vi.mock("@/lib/db", () => ({
  createLeadsBatch: vi.fn(async (_supabase: unknown, values: unknown[]) => ({ created: values, failedIndexes: [] })),
  getUserOrganization: vi.fn(async () => ({ id: "org-1" })),
}));
vi.mock("@/lib/billing/limits", () => ({ getRemainingLeadQuota: vi.fn(async () => 1000) }));
vi.mock("@/lib/rate-limit/check-rate-limit", () => ({
  checkRateLimit: vi.fn(),
  RateLimitError: class RateLimitError extends Error {},
}));

import { createLeadsBatch } from "@/lib/db";
import { importLeadsAction } from "./import-actions";

const mockCreateLeadsBatch = vi.mocked(createLeadsBatch);

function csvForm(csv: string) {
  const formData = new FormData();
  formData.set("file", new File([csv], "leads.csv", { type: "text/csv" }));
  return formData;
}

function importedTimezones() {
  const values = mockCreateLeadsBatch.mock.calls[0][1] as { email: string; timezone: string | null }[];
  return Object.fromEntries(values.map((lead) => [lead.email, lead.timezone]));
}

beforeEach(() => {
  vi.clearAllMocks();
  existingLeads.rows = [];
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
