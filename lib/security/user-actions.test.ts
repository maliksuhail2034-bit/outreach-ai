import { beforeEach, describe, expect, it, vi } from "vitest";

const { getStaffMemberByUserId, revokeUserSessions } = vi.hoisted(() => ({
  getStaffMemberByUserId: vi.fn(),
  revokeUserSessions: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getStaffMemberByUserId, revokeUserSessions }));

import { lockUser, normalizeIpBlock, signOutEverywhere, unlockUser } from "./user-actions";

const updateUserById = vi.fn();
const admin = { auth: { admin: { updateUserById } } } as never;
const SECURITY = { userId: "sec-1", role: "security" as const };
const OWNER = { userId: "own-1", role: "owner" as const };

beforeEach(() => {
  vi.clearAllMocks();
  getStaffMemberByUserId.mockResolvedValue(null);
  revokeUserSessions.mockResolvedValue(2);
  updateUserById.mockResolvedValue({ error: null });
});

describe("lock / unlock / sign out everywhere", () => {
  it("locks a customer: bans sign-in and ends every session", async () => {
    await expect(lockUser(admin, SECURITY, "cust-1")).resolves.toEqual({ sessionsEnded: 2 });
    expect(updateUserById).toHaveBeenCalledWith("cust-1", { ban_duration: "876000h" });
    expect(revokeUserSessions).toHaveBeenCalledWith(admin, "cust-1");
  });

  it("unlocks by lifting the ban", async () => {
    await unlockUser(admin, SECURITY, "cust-1");
    expect(updateUserById).toHaveBeenCalledWith("cust-1", { ban_duration: "none" });
  });

  it("never acts on the operator's own account", async () => {
    await expect(lockUser(admin, SECURITY, "sec-1")).rejects.toThrow(/your own account/);
    await expect(signOutEverywhere(admin, OWNER, "own-1")).rejects.toThrow(/your own account/);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revokeUserSessions).not.toHaveBeenCalled();
  });

  it("security can't lock or sign out an owner; an owner can act on security staff", async () => {
    getStaffMemberByUserId.mockResolvedValue({ role: "owner" });
    await expect(lockUser(admin, SECURITY, "own-2")).rejects.toThrow(/owner/);
    await expect(signOutEverywhere(admin, SECURITY, "own-2")).rejects.toThrow(/owner/);
    expect(revokeUserSessions).not.toHaveBeenCalled();

    getStaffMemberByUserId.mockResolvedValue({ role: "security" });
    await expect(lockUser(admin, OWNER, "sec-2")).resolves.toEqual({ sessionsEnded: 2 });
  });

  it("surfaces an Auth API failure instead of reporting success", async () => {
    updateUserById.mockResolvedValue({ error: new Error("auth down") });
    await expect(lockUser(admin, SECURITY, "cust-1")).rejects.toThrow("auth down");
    expect(revokeUserSessions).not.toHaveBeenCalled();
  });
});

describe("normalizeIpBlock", () => {
  it("accepts single addresses and reasonable ranges", () => {
    expect(normalizeIpBlock(" 203.0.113.7 ", null)).toBe("203.0.113.7");
    expect(normalizeIpBlock("198.51.100.0/24", null)).toBe("198.51.100.0/24");
    expect(normalizeIpBlock("2001:db8::/48", null)).toBe("2001:db8::/48");
  });

  it("rejects garbage and over-broad ranges", () => {
    expect(() => normalizeIpBlock("evil.com", null)).toThrow(/IPv4 or IPv6/);
    expect(() => normalizeIpBlock("10.0.0.0/33", null)).toThrow(/0–32/);
    expect(() => normalizeIpBlock("0.0.0.0/0", null)).toThrow(/too broad/);
    expect(() => normalizeIpBlock("2001::/16", null)).toThrow(/too broad/);
    expect(() => normalizeIpBlock("1.2.3.4/24/1", null)).toThrow();
  });

  it("refuses to block the operator's own address", () => {
    expect(() => normalizeIpBlock("203.0.113.0/24", "203.0.113.9")).toThrow(/your own/);
    expect(normalizeIpBlock("203.0.113.0/24", "198.51.100.1")).toBe("203.0.113.0/24");
  });
});
