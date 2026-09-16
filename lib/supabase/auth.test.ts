import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

import { getCachedProfile } from "./auth";

// Perf/nav fix: app/(app)/layout.tsx (via components/shell/user-menu-data.tsx)
// and the Dashboard/Settings pages each need the signed-in user's profile
// within the same request. getCachedProfile wraps lib/db/profiles'
// getProfile in React cache(), keyed only on userId, so those call sites can
// share one query instead of issuing two. React's cache() only dedupes
// inside an active render (verified: calling a cache()-wrapped function
// outside of React rendering does not memoize), so that specific dedup
// behavior isn't unit-testable here — this covers the functional contract
// instead: given a userId, it fetches and returns that user's profile row
// via the same query lib/db/profiles.getProfile already used.
describe("getCachedProfile", () => {
  beforeEach(() => {
    mockCreateClient.mockReset();
  });

  function stubClient(result: { data: unknown; error: unknown }) {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    const from = vi.fn(() => chain);
    mockCreateClient.mockResolvedValue({ from });
    return { from, chain };
  }

  it("fetches the profile row for the given user id", async () => {
    const profileRow = { user_id: "user-1", full_name: "Ada Lovelace", avatar_url: null, timezone: "UTC" };
    const { from, chain } = stubClient({ data: profileRow, error: null });

    const profile = await getCachedProfile("user-1");

    expect(from).toHaveBeenCalledWith("profiles");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(profile).toEqual(profileRow);
  });

  it("returns null when the user has no profile row yet", async () => {
    stubClient({ data: null, error: null });

    const profile = await getCachedProfile("user-2");

    expect(profile).toBeNull();
  });

  it("propagates a real query error instead of swallowing it", async () => {
    const error = { code: "42501", message: "permission denied", details: "", hint: "" };
    stubClient({ data: null, error });

    await expect(getCachedProfile("user-3")).rejects.toBe(error);
  });
});
