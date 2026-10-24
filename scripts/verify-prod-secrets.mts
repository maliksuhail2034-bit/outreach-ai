// Non-destructive verification of recovered production secrets.
//
// Run from a release directory, with the candidate prod.env loaded by systemd
// (never sourced into a shell):
//   systemd-run --uid=polimatiq --working-directory=/srv/polimatiq/releases/<sha> \
//     --property=EnvironmentFile=/etc/polimatiq/prod.env --wait --pipe --collect \
//     /usr/bin/node --no-warnings scripts/verify-prod-secrets.mts /root/sample-links.txt
//
// What it does, all read-only:
// - Supabase keys: decodes the JWTs (project ref + role) and makes two GETs.
// - Encryption keys: SELECTs a few ciphertexts per table with the service-role
//   key and tries AES-256-GCM decryption. GCM's auth tag means a wrong key
//   fails with certainty. Decrypted values are discarded, never printed.
// - Token secrets: verifies the tokens inside links copied from real sent
//   campaign emails (sample-links.txt, one URL per line) using the app's own
//   verify functions.
// - CRON_SECRET: prints only its SHA-256, to compare inside Postgres with the
//   Vault copy (see docs/hostinger-cutover.md). The hash reveals nothing.
// Output is pass/fail counts only.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const release = process.cwd();
const imp = (p: string) => import(pathToFileURL(resolve(release, p)).href);
const { decryptSecret, parseEncryptionKey } = await imp("lib/crypto/aes-secret.ts");
const { verifyUnsubscribeToken } = await imp("lib/email/unsubscribe-token.ts");
const { verifyOpenTrackingToken, verifyClickTrackingToken } = await imp("lib/email/tracking-token.ts");

const PROD_REF = process.env.EXPECT_SUPABASE_REF ?? "wxhulmbbobkfvtreaspo";
const env = (k: string) => process.env[k] ?? "";
const results: [string, string][] = [];
const report = (name: string, outcome: string) => results.push([name, outcome]);

function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  } catch {
    return null;
  }
}

// --- Supabase ---------------------------------------------------------------
const url = env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const service = env("SUPABASE_SERVICE_ROLE_KEY");
report("NEXT_PUBLIC_SUPABASE_URL", url === `https://${PROD_REF}.supabase.co` ? "PASS" : "FAIL: not the production project URL");
for (const [name, token, role] of [["NEXT_PUBLIC_SUPABASE_ANON_KEY", anon, "anon"], ["SUPABASE_SERVICE_ROLE_KEY", service, "service_role"]] as const) {
  const c = jwtClaims(token);
  report(name, c?.ref === PROD_REF && c?.role === role ? "PASS (ref + role)" : `FAIL: ref=${String(c?.ref)} role=${String(c?.role)}`);
}

async function select(table: string, columns: string[]): Promise<Record<string, string | null>[]> {
  const filter = columns.map((c) => `${c}.not.is.null`).join(",");
  const res = await fetch(`${url}/rest/v1/${table}?select=${columns.join(",")}&or=(${filter})&limit=5`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  return res.json();
}

async function checkKey(envName: string, table: string, columns: string[]) {
  let key: Buffer;
  try {
    key = parseEncryptionKey(envName, env(envName));
  } catch {
    report(envName, "FAIL: missing or not 64 hex characters");
    return;
  }
  try {
    const rows = await select(table, columns);
    const values = rows.flatMap((r) => columns.map((c) => r[c]).filter((v): v is string => Boolean(v)));
    if (values.length === 0) return report(envName, `UNVERIFIABLE: no encrypted values in ${table} yet`);
    let ok = 0;
    for (const v of values) {
      try {
        decryptSecret(v, key); // result deliberately discarded
        ok++;
      } catch {
        /* wrong key or corrupt value */
      }
    }
    report(envName, ok === values.length ? `PASS (${ok}/${values.length} values decrypt)` : `FAIL (${ok}/${values.length} decrypt)`);
  } catch (error) {
    report(envName, `ERROR: ${(error as Error).message}`);
  }
}

if (url && service) {
  await checkKey("MAILBOX_ENCRYPTION_KEY", "mailboxes", [
    "encrypted_smtp_password", "encrypted_imap_password", "encrypted_google_refresh_token", "encrypted_microsoft_refresh_token",
  ]);
  await checkKey("AI_PROVIDER_KEY_ENCRYPTION_KEY", "ai_provider_keys", ["encrypted_api_key"]);
  await checkKey("VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY", "verification_provider_keys", ["encrypted_api_key"]);
}

// --- Token secrets, against links from real sent emails ---------------------
const linksFile = process.argv[2];
if (linksFile && existsSync(linksFile)) {
  const links = readFileSync(linksFile, "utf8").split(/\s+/).filter(Boolean);
  const tally = { unsubscribe: [0, 0], open: [0, 0], click: [0, 0] };
  for (const link of links) {
    const path = new URL(link).pathname;
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/unsubscribe\/([^/]+)/))) {
      tally.unsubscribe[1]++;
      if (verifyUnsubscribeToken(decodeURIComponent(m[1]))) tally.unsubscribe[0]++;
    } else if ((m = path.match(/^\/api\/track\/open\/([^/]+)/))) {
      tally.open[1]++;
      if (verifyOpenTrackingToken(decodeURIComponent(m[1]).replace(/\.(gif|png)$/, ""))) tally.open[0]++;
    } else if ((m = path.match(/^\/api\/track\/click\/([^/]+)/))) {
      tally.click[1]++;
      if (verifyClickTrackingToken(decodeURIComponent(m[1]))) tally.click[0]++;
    }
  }
  const out = (name: string, [ok, n]: number[]) =>
    report(name, n === 0 ? "UNVERIFIED: no sample link of this kind" : ok === n ? `PASS (${ok}/${n} links verify)` : `FAIL (${ok}/${n})`);
  out("UNSUBSCRIBE_TOKEN_SECRET", tally.unsubscribe);
  out("TRACKING_TOKEN_SECRET", tally.open);
  out("CLICK_TRACKING_TOKEN_SECRET", tally.click);
} else {
  for (const k of ["UNSUBSCRIBE_TOKEN_SECRET", "TRACKING_TOKEN_SECRET", "CLICK_TRACKING_TOKEN_SECRET"]) {
    report(k, env(k) ? "UNVERIFIED: no sample links file given" : "FAIL: missing");
  }
}

// --- CRON_SECRET --------------------------------------------------------------
const cron = env("CRON_SECRET");
report("CRON_SECRET", cron ? `sha256=${createHash("sha256").update(cron).digest("hex")} (compare with Vault)` : "FAIL: missing");

for (const [name, outcome] of results) console.log(`${name.padEnd(42)} ${outcome}`);
