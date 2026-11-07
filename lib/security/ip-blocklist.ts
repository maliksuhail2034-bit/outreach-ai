import { BlockList, isIP } from "node:net";
import type { Client } from "@/lib/db/shared";
import { listActiveIpBlocks } from "@/lib/db/security";

// The security team's IP blocklist (public.ip_blocklist), enforced by
// proxy.ts on every page and app API request. Entries are single addresses
// or CIDR ranges, IPv4 or IPv6.
//
// The list is held in memory and reloaded at most once a minute per server
// process, so a new block takes effect within ~60 s and the database sees
// one small query a minute, not one per request. If a reload fails the
// previous list stays in force; with no list loaded yet the check fails
// open — a database outage must not take the whole app down with it.

const CACHE_TTL_MS = 60_000;

interface CachedList {
  list: BlockList;
  expiresAt: number[];
  loadedAt: number;
}

let cached: CachedList | null = null;
let loading: Promise<CachedList | null> | null = null;

function familyOf(address: string): "ipv4" | "ipv6" | null {
  const version = isIP(address);
  return version === 4 ? "ipv4" : version === 6 ? "ipv6" : null;
}

// Pure: builds a matcher from the stored entries. Postgres returns inet
// values as "1.2.3.4" (a single host) or "10.0.0.0/8". Entries that don't
// parse are skipped rather than blocking everything.
export function buildBlockList(entries: readonly { cidr: string }[]): BlockList {
  const list = new BlockList();
  for (const { cidr } of entries) {
    const [address, prefixText] = cidr.trim().split("/");
    const family = familyOf(address);
    if (!family) continue;
    if (prefixText === undefined) {
      list.addAddress(address, family);
      continue;
    }
    const prefix = Number(prefixText);
    const max = family === "ipv4" ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) continue;
    list.addSubnet(address, prefix, family);
  }
  return list;
}

// Normalizes an IPv4-mapped IPv6 address ("::ffff:1.2.3.4") so a block on
// 1.2.3.4 also matches when the server reports the mapped form.
export function isIpBlocked(list: BlockList, ip: string): boolean {
  const address = ip.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
  const family = familyOf(address);
  return family ? list.check(address, family) : false;
}

async function load(supabase: Client, now: number): Promise<CachedList | null> {
  try {
    const entries = await listActiveIpBlocks(supabase, new Date(now).toISOString());
    return {
      list: buildBlockList(entries),
      expiresAt: entries.map((entry) => (entry.expiresAt ? new Date(entry.expiresAt).getTime() : Infinity)),
      loadedAt: now,
    };
  } catch (error) {
    console.error("[ip-blocklist] reload failed, keeping the previous list", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return cached;
  }
}

async function currentList(getClient: () => Client, now: number): Promise<CachedList | null> {
  // A temporary block that expired since the last load forces a reload, so
  // it never outlives its expiry by up to a minute.
  const stale = !cached || now - cached.loadedAt >= CACHE_TTL_MS || cached.expiresAt.some((at) => at <= now);
  if (!stale) return cached;
  loading ??= load(getClient(), now).finally(() => {
    loading = null;
  });
  cached = await loading;
  return cached;
}

export async function isRequestIpBlocked(ip: string | null, getClient: () => Client, now: number = Date.now()): Promise<boolean> {
  if (!ip) return false;
  const current = await currentList(getClient, now);
  return current ? isIpBlocked(current.list, ip) : false;
}

// Tests only.
export function resetIpBlocklistCache(): void {
  cached = null;
  loading = null;
}
