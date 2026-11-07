import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getStaffMember: vi.fn(),
  updateStaffMember: vi.fn(),
  insertStaffMember: vi.fn(),
  countActiveOwners: vi.fn(),
  revokeUserSessions: vi.fn(),
}));
const work = vi.hoisted(() => ({ endStaffActivity: vi.fn() }));
vi.mock("@/lib/db", () => db);
vi.mock("./work-session", () => work);
vi.mock("@/lib/app-url", () => ({ appUrl: (path: string) => new URL(path, "https://polimatiq.test") }));

import {
  changeStaffUsername,
  createStaffAccount,
  archiveStaffAccount,
  setOwnPassword,
  setStaffDisabled,
  setStaffPassword,
  signOutStaffEverywhere,
} from "./accounts";

const admin = {
  auth: {
    admin: {
      updateUserById: vi.fn(),
      deleteUser: vi.fn(),
      createUser: vi.fn(),
      generateLink: vi.fn(),
    },
  },
} as never as Parameters<typeof setStaffPassword>[0];
const authAdmin = (admin as unknown as { auth: { admin: Record<string, ReturnType<typeof vi.fn>> } }).auth.admin;

const OWNER = { userId: "owner-user", role: "owner" as const };
const SECURITY = { userId: "security-user", role: "security" as const };

function staffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "staff-1",
    user_id: "user-1",
    role: "sales",
    status: "active",
    username: "sam.sales",
    display_name: "Sam Sales",
    password_must_change: false,
    password_policy_version: 1,
    ...overrides,
  };
}

const STRONG = "Very-Strong-Pass-2026";

beforeEach(() => {
  vi.clearAllMocks();
  db.getStaffMember.mockResolvedValue(staffRow());
  db.updateStaffMember.mockImplementation(async (_admin: unknown, id: string, values: Record<string, unknown>) => ({ ...staffRow(), id, ...values }));
  db.countActiveOwners.mockResolvedValue(2);
  db.revokeUserSessions.mockResolvedValue(3);
  authAdmin.updateUserById.mockResolvedValue({ error: null });
  authAdmin.deleteUser.mockResolvedValue({ error: null });
});

describe("setStaffPassword", () => {
  it("sets the password, ends every session and flags a must-change", async () => {
    const updated = await setStaffPassword(admin, OWNER, "staff-1", STRONG, true);
    expect(authAdmin.updateUserById).toHaveBeenCalledWith("user-1", { password: STRONG });
    expect(db.revokeUserSessions).toHaveBeenCalledWith(admin, "user-1");
    expect(work.endStaffActivity).toHaveBeenCalledWith("staff-1", "access_changed");
    expect(updated).toMatchObject({ password_must_change: true, password_policy_version: 1 });
  });

  it("applies the target's role policy: 16+ and a symbol for security accounts", async () => {
    db.getStaffMember.mockResolvedValue(staffRow({ role: "security", username: "sec.one" }));
    await expect(setStaffPassword(admin, OWNER, "staff-1", "SalesTeam2026x", true)).rejects.toThrow("Must be at least 16 characters.");
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
  });

  it("refuses security setting an owner's password", async () => {
    db.getStaffMember.mockResolvedValue(staffRow({ role: "owner" }));
    await expect(setStaffPassword(admin, SECURITY, "staff-1", STRONG, true)).rejects.toThrow("Your role can't manage owner accounts.");
  });

  it("refuses acting on your own account and on blocked accounts", async () => {
    db.getStaffMember.mockResolvedValue(staffRow({ user_id: "owner-user" }));
    await expect(setStaffPassword(admin, OWNER, "staff-1", STRONG, true)).rejects.toThrow("You can't change your own staff account here.");
    db.getStaffMember.mockResolvedValue(staffRow({ status: "disabled" }));
    await expect(setStaffPassword(admin, OWNER, "staff-1", STRONG, true)).rejects.toThrow(/Unblock the account/);
  });
});

describe("blocking, sign-out and archiving", () => {
  it("blocking bans sign-in, ends sessions and closes the work session", async () => {
    await setStaffDisabled(admin, OWNER, "staff-1", true);
    expect(authAdmin.updateUserById).toHaveBeenCalledWith("user-1", { ban_duration: "876000h" });
    expect(db.revokeUserSessions).toHaveBeenCalled();
    expect(work.endStaffActivity).toHaveBeenCalledWith("staff-1", "access_changed");
  });

  it("signs an employee out everywhere without blocking them", async () => {
    await expect(signOutStaffEverywhere(admin, SECURITY, "staff-1")).resolves.toBe(3);
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
  });

  it("archives only after the username is typed exactly, keeping the record", async () => {
    await expect(archiveStaffAccount(admin, OWNER, "staff-1", "sam")).rejects.toThrow("Type the username exactly to confirm.");
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();

    const archived = await archiveStaffAccount(admin, OWNER, "staff-1", " SAM.SALES ");
    expect(authAdmin.updateUserById).toHaveBeenCalledWith("user-1", { ban_duration: "876000h" });
    expect(db.revokeUserSessions).toHaveBeenCalledWith(admin, "user-1");
    expect(work.endStaffActivity).toHaveBeenCalledWith("staff-1", "access_changed");
    expect(archived).toMatchObject({ status: "archived", archived_by: "owner-user", archived_at: expect.any(String) });
    // Never deleted: hours and history stay.
    expect(authAdmin.deleteUser).not.toHaveBeenCalled();
  });

  it("never archives the last active owner", async () => {
    db.getStaffMember.mockResolvedValue(staffRow({ role: "owner", username: "the.owner" }));
    db.countActiveOwners.mockResolvedValue(1);
    await expect(archiveStaffAccount(admin, { userId: "other-owner", role: "owner" }, "staff-1", "the.owner")).rejects.toThrow(/only active owner/);
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
  });

  it("refuses every management action on an archived account", async () => {
    db.getStaffMember.mockResolvedValue(staffRow({ status: "archived" }));
    await expect(setStaffDisabled(admin, OWNER, "staff-1", false)).rejects.toThrow(/archived/);
    await expect(setStaffPassword(admin, OWNER, "staff-1", STRONG, true)).rejects.toThrow(/archived/);
    await expect(archiveStaffAccount(admin, OWNER, "staff-1", "sam.sales")).rejects.toThrow(/archived/);
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
  });
});

describe("usernames", () => {
  it("renames, lowercased, and reports the previous name", async () => {
    await expect(changeStaffUsername(admin, OWNER, "staff-1", "Sam.Sales2")).resolves.toMatchObject({ previous: "sam.sales", staff: { username: "sam.sales2" } });
  });

  it("explains a taken username", async () => {
    db.updateStaffMember.mockRejectedValue({ code: "23505" });
    await expect(changeStaffUsername(admin, OWNER, "staff-1", "taken.name")).rejects.toThrow("That username is already taken. Choose another.");
  });
});

describe("createStaffAccount", () => {
  it("creates an invited account that must choose its own password", async () => {
    authAdmin.createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
    authAdmin.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "tok" } }, error: null });
    db.insertStaffMember.mockResolvedValue(staffRow({ id: "new-staff" }));

    const result = await createStaffAccount(admin, OWNER, { email: "sam@acme.test", displayName: "Sam", username: "Sam.Sales", role: "sales" });

    expect(db.insertStaffMember).toHaveBeenCalledWith(admin, expect.objectContaining({ username: "sam.sales", password_must_change: true, status: "invited" }));
    expect(new URL(result.setupLink).searchParams.get("next")).toBe("/console/account?required=password");
  });

  it("rolls the auth user back when the username is taken", async () => {
    authAdmin.createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
    db.insertStaffMember.mockRejectedValue({ code: "23505" });
    await expect(createStaffAccount(admin, OWNER, { email: "x@acme.test", displayName: "X", username: "taken", role: "sales" })).rejects.toThrow(/already taken/);
    expect(authAdmin.deleteUser).toHaveBeenCalledWith("new-user");
  });

  it("refuses security creating an owner", async () => {
    await expect(createStaffAccount(admin, SECURITY, { email: "o@acme.test", displayName: "O", username: "new.owner", role: "owner" })).rejects.toThrow(/can't create owner/);
    expect(authAdmin.createUser).not.toHaveBeenCalled();
  });
});

describe("setOwnPassword", () => {
  it("applies the person's own role policy, changes it through their own session and marks the account compliant", async () => {
    const owner = staffRow({ role: "owner", username: "malik" }) as never;
    const updateOwn = vi.fn().mockResolvedValue({ error: null });
    await expect(setOwnPassword(admin, owner, "malik@acme.test", "Short1!", updateOwn)).rejects.toThrow("Must be at least 16 characters.");
    await setOwnPassword(admin, owner, "malik@acme.test", STRONG, updateOwn);
    expect(updateOwn).toHaveBeenCalledWith(STRONG);
    // Never the admin API, which would end the session they're using.
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
    expect(db.updateStaffMember).toHaveBeenCalledWith(admin, "staff-1", expect.objectContaining({ password_must_change: false, password_policy_version: 1 }));
  });

  it("explains a reused password", async () => {
    const owner = staffRow({ role: "owner", username: "malik" }) as never;
    const updateOwn = vi.fn().mockResolvedValue({ error: { message: "New password should be different from the old password." } });
    await expect(setOwnPassword(admin, owner, null, STRONG, updateOwn)).rejects.toThrow("Choose a password you haven't used before.");
    expect(db.updateStaffMember).not.toHaveBeenCalled();
  });
});
