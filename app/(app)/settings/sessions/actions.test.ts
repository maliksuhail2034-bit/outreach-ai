import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = { auth: { signOut: vi.fn() } };

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => supabase) }));
vi.mock("@/lib/supabase/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ revokeMySession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { requireUser } from "@/lib/supabase/auth";
import { revokeMySession } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { revokeSessionAction, signOutAllSessionsAction } from "./actions";

const SESSION_ID = "8490907d-241e-4b81-b051-8614a28ea250";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("revokeSessionAction", () => {
  it("revokes the session and refreshes the list", async () => {
    vi.mocked(revokeMySession).mockResolvedValue(true);

    await revokeSessionAction(SESSION_ID);

    expect(revokeMySession).toHaveBeenCalledWith(supabase, SESSION_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/sessions");
  });

  it("rejects an id that isn't a uuid before touching the database", async () => {
    await expect(revokeSessionAction("not-a-uuid")).rejects.toThrow();
    expect(revokeMySession).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("Unauthorized: no authenticated user."));

    await expect(revokeSessionAction(SESSION_ID)).rejects.toThrow("Unauthorized");
    expect(revokeMySession).not.toHaveBeenCalled();
  });

  it("fails when the session isn't the caller's or no longer exists", async () => {
    vi.mocked(revokeMySession).mockResolvedValue(false);

    await expect(revokeSessionAction(SESSION_ID)).rejects.toThrow("Session not found.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("signOutAllSessionsAction", () => {
  it("ends every session and returns to /login", async () => {
    supabase.auth.signOut.mockResolvedValue({ error: null });

    await expect(signOutAllSessionsAction()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("surfaces a failure instead of redirecting", async () => {
    supabase.auth.signOut.mockResolvedValue({ error: new Error("network") });

    await expect(signOutAllSessionsAction()).rejects.toThrow("network");
  });
});
