import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getUserById: vi.fn(),
  getStaffMemberByUsername: vi.fn(),
  recordSignInEvent: vi.fn(),
  checkRateLimit: vi.fn(),
  releaseRateLimitAttempt: vi.fn(),
  getStaffSession: vi.fn(),
  markStaffSeen: vi.fn(),
  endStaffActivity: vi.fn(),
  recordStaffActivity: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { getUserById: mocks.getUserById } } }) }));
vi.mock("@/lib/db", () => ({ getStaffMemberByUsername: mocks.getStaffMemberByUsername }));
vi.mock("@/lib/security/auth-events", () => ({ recordSignInEvent: mocks.recordSignInEvent }));
vi.mock("@/lib/rate-limit/get-client-ip", () => ({ getClientIp: async () => "203.0.113.7" }));
vi.mock("@/lib/rate-limit/check-rate-limit", () => {
  class RateLimitError extends Error {
    constructor(public readonly retryAfterSeconds: number) {
      super(`Too many attempts. Try again in ${retryAfterSeconds} seconds.`);
    }
  }
  return { checkRateLimit: mocks.checkRateLimit, releaseRateLimitAttempt: mocks.releaseRateLimitAttempt, RateLimitError };
});
vi.mock("@/lib/staff/auth", () => ({ getStaffSession: mocks.getStaffSession, markStaffSeen: mocks.markStaffSeen }));
vi.mock("@/lib/staff/work-session", () => ({ endStaffActivity: mocks.endStaffActivity, recordStaffActivity: mocks.recordStaffActivity }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { staffHeartbeatAction, staffIdleSignOutAction, staffSignInAction, staffSignOutAction } from "./session-actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const STAFF = { id: "staff-1", user_id: "user-1", status: "active", username: "malik" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(true);
  mocks.getStaffMemberByUsername.mockResolvedValue(STAFF);
  mocks.getUserById.mockResolvedValue({ data: { user: { email: "malik+owner@acme.test" } } });
  mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("staffSignInAction", () => {
  it("signs in with the username's account email and continues to the console", async () => {
    await expect(staffSignInAction(undefined, form({ username: " Malik ", password: "pw" }))).rejects.toThrow("NEXT_REDIRECT:/console");
    expect(mocks.getStaffMemberByUsername).toHaveBeenCalledWith(expect.anything(), "malik");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "malik+owner@acme.test", password: "pw" });
    expect(mocks.recordSignInEvent).toHaveBeenCalledWith("sign_in_success", { userId: "user-1" });
    expect(mocks.releaseRateLimitAttempt).toHaveBeenCalledTimes(2);
  });

  it("gives the same answer for an unknown username, a blocked account and a wrong password", async () => {
    mocks.getStaffMemberByUsername.mockResolvedValueOnce(null);
    const unknown = await staffSignInAction(undefined, form({ username: "nobody", password: "pw" }));

    mocks.getStaffMemberByUsername.mockResolvedValueOnce({ ...STAFF, status: "disabled" });
    const blocked = await staffSignInAction(undefined, form({ username: "malik", password: "pw" }));

    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid login credentials" } });
    const wrong = await staffSignInAction(undefined, form({ username: "malik", password: "bad" }));

    expect(unknown).toEqual({ error: "Wrong username or password." });
    expect(blocked).toEqual(unknown);
    expect(wrong).toEqual(unknown);
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRateLimitAttempt).not.toHaveBeenCalled();
  });

  it("never accepts a session for a different user than the username's", async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: "someone-else" } }, error: null });
    await expect(staffSignInAction(undefined, form({ username: "malik", password: "pw" }))).resolves.toEqual({ error: "Wrong username or password." });
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it("is rate limited per address and per username before any lookup", async () => {
    const { RateLimitError } = await import("@/lib/rate-limit/check-rate-limit");
    mocks.checkRateLimit.mockRejectedValueOnce(new RateLimitError(900));
    await expect(staffSignInAction(undefined, form({ username: "malik", password: "pw" }))).resolves.toEqual({ error: "Too many attempts. Try again in 900 seconds." });
    expect(mocks.getStaffMemberByUsername).not.toHaveBeenCalled();
  });
});

describe("sign-out and heartbeat", () => {
  it("closes the work session, then signs out to the staff sign-in page", async () => {
    mocks.getStaffSession.mockResolvedValue({ staff: { id: "staff-1" }, mfa: "verified" });
    await expect(staffSignOutAction()).rejects.toThrow("NEXT_REDIRECT:/console/login");
    expect(mocks.endStaffActivity).toHaveBeenCalledWith("staff-1", "signed_out");
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it("records activity only for a verified staff session", async () => {
    mocks.getStaffSession.mockResolvedValueOnce(null);
    await staffHeartbeatAction();
    mocks.getStaffSession.mockResolvedValueOnce({ staff: { id: "staff-1" }, mfa: "needs_verification" });
    await staffHeartbeatAction();
    expect(mocks.recordStaffActivity).not.toHaveBeenCalled();

    mocks.getStaffSession.mockResolvedValueOnce({ staff: { id: "staff-1" }, mfa: "verified" });
    await staffHeartbeatAction();
    expect(mocks.recordStaffActivity).toHaveBeenCalledWith("staff-1");
    expect(mocks.markStaffSeen).toHaveBeenCalledTimes(1);
  });

  it("idle sign-out closes the work session as idle and ends only this browser's session", async () => {
    mocks.getStaffSession.mockResolvedValue({ staff: { id: "staff-1" }, mfa: "verified" });
    await expect(staffIdleSignOutAction()).rejects.toThrow("NEXT_REDIRECT:/console/login?reason=idle");
    expect(mocks.endStaffActivity).toHaveBeenCalledWith("staff-1", "idle");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
