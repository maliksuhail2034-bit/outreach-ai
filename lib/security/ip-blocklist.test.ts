import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/lib/db/shared";

const { listActiveIpBlocks } = vi.hoisted(() => ({ listActiveIpBlocks: vi.fn() }));
vi.mock("@/lib/db/security", () => ({ listActiveIpBlocks }));

import { buildBlockList, isIpBlocked, isRequestIpBlocked, resetIpBlocklistCache } from "./ip-blocklist";

const client = () => ({}) as Client;

beforeEach(() => {
  vi.clearAllMocks();
  resetIpBlocklistCache();
});

describe("buildBlockList / isIpBlocked", () => {
  const list = buildBlockList([{ cidr: "203.0.113.7" }, { cidr: "198.51.100.0/24" }, { cidr: "2001:db8::/32" }]);

  it("matches single addresses and ranges, IPv4 and IPv6", () => {
    expect(isIpBlocked(list, "203.0.113.7")).toBe(true);
    expect(isIpBlocked(list, "198.51.100.200")).toBe(true);
    expect(isIpBlocked(list, "2001:db8:1::5")).toBe(true);
  });

  it("doesn't match neighbours", () => {
    expect(isIpBlocked(list, "203.0.113.8")).toBe(false);
    expect(isIpBlocked(list, "198.51.101.1")).toBe(false);
    expect(isIpBlocked(list, "2001:db9::1")).toBe(false);
  });

  it("matches the IPv4-mapped IPv6 form of a blocked address", () => {
    expect(isIpBlocked(list, "::ffff:203.0.113.7")).toBe(true);
  });

  it("ignores garbage instead of blocking everyone", () => {
    const broken = buildBlockList([{ cidr: "not-an-ip" }, { cidr: "10.0.0.0/99" }]);
    expect(isIpBlocked(broken, "10.0.0.1")).toBe(false);
    expect(isIpBlocked(list, "unknown")).toBe(false);
  });
});

describe("isRequestIpBlocked", () => {
  it("caches the list for a minute", async () => {
    listActiveIpBlocks.mockResolvedValue([{ cidr: "203.0.113.7", expiresAt: null }]);
    const t0 = 1_000_000;

    expect(await isRequestIpBlocked("203.0.113.7", client, t0)).toBe(true);
    expect(await isRequestIpBlocked("203.0.113.7", client, t0 + 30_000)).toBe(true);
    expect(listActiveIpBlocks).toHaveBeenCalledTimes(1);

    listActiveIpBlocks.mockResolvedValue([]);
    expect(await isRequestIpBlocked("203.0.113.7", client, t0 + 61_000)).toBe(false);
    expect(listActiveIpBlocks).toHaveBeenCalledTimes(2);
  });

  it("reloads as soon as a temporary block expires", async () => {
    const t0 = 1_000_000;
    listActiveIpBlocks.mockResolvedValueOnce([{ cidr: "203.0.113.7", expiresAt: new Date(t0 + 10_000).toISOString() }]);
    expect(await isRequestIpBlocked("203.0.113.7", client, t0)).toBe(true);

    listActiveIpBlocks.mockResolvedValueOnce([]);
    expect(await isRequestIpBlocked("203.0.113.7", client, t0 + 10_000)).toBe(false);
  });

  it("keeps the last good list when a reload fails, and fails open with none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listActiveIpBlocks.mockRejectedValueOnce(new Error("db down"));
    expect(await isRequestIpBlocked("203.0.113.7", client, 0)).toBe(false);

    listActiveIpBlocks.mockResolvedValueOnce([{ cidr: "203.0.113.7", expiresAt: null }]);
    expect(await isRequestIpBlocked("203.0.113.7", client, 1)).toBe(true);

    listActiveIpBlocks.mockRejectedValueOnce(new Error("db down"));
    expect(await isRequestIpBlocked("203.0.113.7", client, 70_000)).toBe(true);
  });

  it("never blocks a request without a known IP", async () => {
    expect(await isRequestIpBlocked(null, client)).toBe(false);
    expect(listActiveIpBlocks).not.toHaveBeenCalled();
  });
});
