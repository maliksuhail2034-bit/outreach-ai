# Self-hosting Polimatiq (Ubuntu VPS + Caddy)

How to run Polimatiq on a single Linux server instead of Vercel. Written for
a Hostinger VPS running Ubuntu LTS, but nothing below is Hostinger-specific
except the "Hostinger VPS" section. This only covers what differs from
Vercel. Every other environment variable is the same as in production.

```
Internet ──443──▶ Caddy (TLS, sets X-Forwarded-For) ──▶ 127.0.0.1:3000  next start
Supabase pg_cron ──HTTPS──▶ same hostname /api/cron/*
```

## Billing region detection: why this matters

Indian visitors pay in INR and everyone else pays in USD (`lib/billing/region.ts`).

- **On Vercel**, the country comes from Vercel's `x-vercel-ip-country` header.
  That header is only trusted when `VERCEL=1`, which Vercel sets itself.
- **Self-hosted**, there is no Vercel edge. The app looks up the client IP in a
  local GeoIP country database (`lib/billing/geoip.ts`). Every country header
  a client sends (`x-vercel-ip-country`, `cf-ipcountry`, …) is ignored.
- **When the country can't be determined**, the visitor is treated as
  international (USD). This covers: no database configured, no working
  database loaded (the file was missing or corrupt when the app first tried
  it), no client IP, invalid IP, or an IP not in the database. An unknown
  visitor is never routed to INR.
- **A failed reload doesn't cause that fallback.** If a replacement file is
  missing or corrupt, the app keeps using the last working database, logs the
  failure, and tries again at the next hourly check.

**Never set `VERCEL=1` on a self-hosted server.** It would make the app trust a
client-supplied `x-vercel-ip-country` header.

## Trusted-proxy assumptions

The client IP is the **right-most** `X-Forwarded-For` entry
(`lib/rate-limit/get-client-ip.ts`). Billing and the auth rate limits both use
it. This is only correct when all of the following hold:

1. **Caddy is the only proxy in front of the app, and it replaces the header.**
   Caddy must replace `X-Forwarded-For` with the TCP peer address
   (`header_up X-Forwarded-For {remote_host}`, shown below). Next.js only fills
   the header in when it is absent, so Caddy's value reaches the app unchanged.
2. **The app is unreachable except through Caddy.**
   - `next start` listens on 0.0.0.0 by default, so start it with
     `-H 127.0.0.1`.
   - Allow only 22, 80 and 443 in the firewall.
3. **No other proxy hop sits in front of Caddy.** That rules out a Cloudflare
   proxy, a hosting provider's load balancer, or another CDN. Adding one means
   `{remote_host}` becomes that hop's address. Configure Caddy's
   `trusted_proxies` and use `{client_ip}` instead before adding one.

## GeoIP country database

Polimatiq uses DB-IP's free **IP to Country Lite** database, in the MaxMind DB
format (`.mmdb`). The app reads only `country.iso_code` from it. Point
`GEOIP_COUNTRY_DB_PATH` at the file. Any `.mmdb` country database with that
field works (MaxMind GeoLite2-Country does too) if the source ever changes.

The app re-checks the file's modification time at most once an hour and
reloads it when it changes, so updating the database needs no restart.

### Licence and attribution

- **Licence:** [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
  No account or key. The download page asks you to agree to the licensing
  terms; agreeing is the site owner's decision, made once, before the first
  download.
- **Attribution (required).** DB-IP's terms for web applications: a link back
  to DB-IP.com on the pages that use the results, with this wording:
  `<a href='https://db-ip.com'>IP Geolocation by DB-IP</a>`. In the app:
  - `components/billing/geoip-attribution.tsx` renders exactly that link on
    the two pages whose content depends on the visitor's country: the pricing
    section and `/billing`. It renders only when the local database is in use
    (`usesLocalGeoip()`: off Vercel, with `GEOIP_COUNTRY_DB_PATH` set).
  - The privacy policy names DB-IP as the source, with the licence link.
- **No modification.** The file is used as published. If it is ever modified,
  CC BY 4.0 requires saying so.
- **Accuracy.** IP geolocation is approximate. A visitor on a VPN or a
  misattributed range can land in the wrong region. The worst case is USD for
  an Indian visitor, never INR for someone abroad by header spoofing.

### Monthly update

DB-IP publishes a new Lite release each month as
`https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz`.
The updater below downloads it, checks it, and only then swaps it in; on any
failure the current file is left untouched. Save it as
`/usr/local/sbin/update-dbip-country` (root:root, 0755). The shebang must be
the file's first line: a comment above it makes systemd fail with
`203/EXEC` ("Exec format error").

```bash
#!/usr/bin/env bash
set -euo pipefail
DEST=/var/lib/dbip/dbip-country-lite.mmdb
NODE_MODULES=/srv/polimatiq/current/node_modules   # for mmdb-lib, used in the check
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

fetch() { curl -fsSL --max-time 300 -o "$TMP/db.gz" "https://download.db-ip.com/free/dbip-country-lite-$1.mmdb.gz"; }
# Early in a month the new file may not be published yet: fall back to last month's.
fetch "$(date -u +%Y-%m)" || fetch "$(date -u -d "$(date -u +%Y-%m-01) -1 month" +%Y-%m)"
gunzip -c "$TMP/db.gz" > "$TMP/db.mmdb"

# Refuse a file that doesn't resolve well-known addresses correctly.
NODE_PATH=$NODE_MODULES node -e '
  const { Reader } = require("mmdb-lib");
  const r = new Reader(require("fs").readFileSync(process.argv[1]));
  const want = { "8.8.8.8": "US", "49.36.0.1": "IN" };
  for (const [ip, cc] of Object.entries(want)) {
    const got = r.get(ip)?.country?.iso_code;
    if (got !== cc) { console.error(`check failed: ${ip} -> ${got}, expected ${cc}`); process.exit(1); }
  }
  console.log("ok, built", r.metadata.buildEpoch.toISOString());' "$TMP/db.mmdb"

install -d -m 0755 /var/lib/dbip
install -m 0644 "$TMP/db.mmdb" "$DEST.new"
mv -f "$DEST.new" "$DEST"   # atomic: the app never sees a half-written file
```

```ini
# /etc/systemd/system/update-dbip-country.service
[Unit]
Description=Update DB-IP IP to Country Lite
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/update-dbip-country

# /etc/systemd/system/update-dbip-country.timer
[Unit]
Description=Update DB-IP IP to Country Lite monthly
[Timer]
OnCalendar=*-*-03 06:00
RandomizedDelaySec=2h
Persistent=true
[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl start update-dbip-country      # first download (after the licence is accepted)
sudo systemctl enable --now update-dbip-country.timer
systemctl list-timers update-dbip-country.timer
```

Then set `GEOIP_COUNTRY_DB_PATH=/var/lib/dbip/dbip-country-lite.mmdb` in the
environment file and restart the service.

- The app logs `[geoip] country database is N days old` (at most once a day)
  when the loaded database is more than 45 days old, measured from the build
  date inside the file. A healthy monthly update keeps it under ~33 days, so a
  warning means the timer has stopped working: check
  `journalctl -u update-dbip-country`.

## Third-party data notices

Self-hosted deployments of Polimatiq use DB-IP IP to Country Lite for billing
region detection, under the
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
licence. <a href='https://db-ip.com'>IP Geolocation by DB-IP</a>.

## Caddy

```caddyfile
# /etc/caddy/Caddyfile
your.app.hostname {
	encode zstd gzip

	reverse_proxy 127.0.0.1:3000 {
		# The app reads the client IP from the right-most X-Forwarded-For
		# entry. Replace whatever the client sent with the real TCP peer
		# address, so a client can't choose its own IP or country.
		header_up X-Forwarded-For {remote_host}
		# Defense in depth: the app ignores these off Vercel anyway.
		header_up -X-Vercel-IP-Country
		header_up -CF-IPCountry
		header_up -X-Real-IP
	}
}
```

## systemd service

```ini
# /etc/systemd/system/polimatiq.service
[Unit]
Description=Polimatiq (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
User=polimatiq
WorkingDirectory=/srv/polimatiq/current
EnvironmentFile=/etc/polimatiq/prod.env
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=1024
# -H 127.0.0.1: only Caddy may reach the app (see "Trusted-proxy assumptions").
ExecStart=/srv/polimatiq/current/node_modules/.bin/next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5
# next start exits 143 on SIGTERM; that is a clean stop, not a failure.
SuccessExitStatus=143
MemoryMax=1600M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

## Production environment file

`/etc/polimatiq/prod.env` holds the same variables as the Vercel production
environment, plus:

| Variable | Value |
|---|---|
| `GEOIP_COUNTRY_DB_PATH` | Absolute path to the `.mmdb` file, e.g. `/var/lib/dbip/dbip-country-lite.mmdb`. If unset, the app logs `[geoip] GEOIP_COUNTRY_DB_PATH is not set` once and bills everyone in USD. |
| `VERCEL` | **Must not be set** |

**Permissions:**
- The file stays **root-owned, mode 600**, inside a root-only directory.
- The `polimatiq` user never reads it directly.
- systemd reads it as root and passes the variables to the process: the
  service through `EnvironmentFile=`, and the build through `systemd-run`
  (see "Building and releasing").

```bash
sudo install -d -m 700 -o root -g root /etc/polimatiq
sudo install -m 600 -o root -g root /dev/null /etc/polimatiq/prod.env
sudoedit /etc/polimatiq/prod.env
```

**Format:** the service and the build both use systemd's `EnvironmentFile`
parser, so they always see the same values. That format is:
- one `KEY=value` per line, with no `export`;
- quotes are optional;
- no `$VAR` expansion.

## Building and releasing

`NEXT_PUBLIC_*` values are compiled into the client bundle at build time, so
the build must see the production environment. Don't `source` the file in a
shell as `polimatiq`: that user can't read it, by design, and `source` without
`set -a` doesn't export the variables to `next build` anyway.

```bash
SHA=<commit to deploy>
REL=/srv/polimatiq/releases/$SHA

# 1. Check out the release as the app user.
sudo -u polimatiq git clone --no-checkout <repo-url> "$REL"
sudo -u polimatiq git -C "$REL" checkout --detach "$SHA"

# 2. Install dependencies WITHOUT the production secrets in the environment.
#    Package install scripts never see them.
sudo -u polimatiq bash -c "cd '$REL' && npm ci"

# 3. Build as polimatiq. systemd (running as root) reads the root-only env
#    file and passes it to the build, exactly as it does for the service.
sudo systemd-run --uid=polimatiq --gid=polimatiq \
  --working-directory="$REL" \
  --property=EnvironmentFile=/etc/polimatiq/prod.env \
  --setenv=NODE_OPTIONS=--max-old-space-size=1536 \
  --wait --pipe --collect \
  /usr/bin/npm run build

# 4. Switch over. Roll back by pointing `current` at the previous release.
sudo ln -sfn "$REL" /srv/polimatiq/current
sudo systemctl restart polimatiq
```

The build needs about 1.5 GB of memory: add a swapfile on a server with 2 GB
of RAM or less.

### Rollback

Releases are never modified after they are built, so rolling back is a
symlink switch to the previous release and a restart:

```bash
ls -1t /srv/polimatiq/releases            # newest first
sudo ln -sfn /srv/polimatiq/releases/<previous-sha> /srv/polimatiq/current
sudo systemctl restart polimatiq
curl -fsS https://your.app.hostname/api/health
```

Keep at least the previous two releases. A rollback never touches the
database: no release applies migrations (those are applied separately with
the Supabase CLI), so an older release only needs to be compatible with the
current schema.

### Logs

```bash
journalctl -u polimatiq -f                       # follow
journalctl -u polimatiq --since "1 hour ago" -p err
journalctl -u caddy --since today
```

Ubuntu keeps the journal on disk (`/var/log/journal`) across reboots. Check
with `journalctl --list-boots`. Each cron run is also recorded in the
`job_runs` table.

## Hostinger VPS

- **SSH keys:** VPS dashboard → Manage → Settings → SSH keys → Add SSH key.
  Only the public key goes there.
- **Two firewalls.** Hostinger's managed firewall (VPS dashboard → Security
  → Firewall) drops all inbound traffic once a rule group is active, so add
  accept rules for 22, 80 and 443 *before* activating one, or SSH is locked
  out. `ufw` on the server is a second, independent layer: allow OpenSSH
  before `ufw enable`.
  ```bash
  sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
  sudo ufw enable && sudo ufw status verbose
  ```
- **Outbound mail ports:** Hostinger states it does not block outbound SMTP on
  VPS plans. Verify 465/587/993 from the server before relying on it (see
  "Outbound SMTP/IMAP check" below).
- **Node.js:** install the current LTS from NodeSource (Node 24; the app needs
  ≥ 20.9). Use the same major version for every build and run.

## Outbound SMTP/IMAP check

Prove the server can reach mail providers without sending mail or using any
mailbox credentials: open the connection, read the greeting, then quit. No
AUTH, LOGIN, MAIL FROM or RCPT TO is ever sent.

```bash
for t in smtp.gmail.com:465 smtp.gmail.com:587 imap.gmail.com:993 \
         smtp.office365.com:587 outlook.office365.com:993 \
         smtp.hostinger.com:465 smtp.hostinger.com:587 imap.hostinger.com:993; do
  host=${t%:*}; port=${t#*:}
  case $port in
    # openssl does the greeting, EHLO and STARTTLS itself; sending anything
    # after the handshake gets rejected by some servers for pipelining.
    587) out=$(timeout 15 openssl s_client -brief -starttls smtp -connect "$t" -servername "$host" </dev/null 2>&1 | grep -m1 'CONNECTION ESTABLISHED') ;;
    993) out=$(printf 'a1 LOGOUT\r\n' | timeout 15 openssl s_client -quiet -connect "$t" -servername "$host" 2>/dev/null | grep -m1 -E '^\* OK') ;;
    *)   out=$(printf 'QUIT\r\n' | timeout 15 openssl s_client -quiet -connect "$t" -servername "$host" 2>/dev/null | grep -m1 -E '^220') ;;
  esac
  [ -n "$out" ] && echo "OK   $t" || echo "FAIL $t"
done
```

## Staging on the same server

Staging runs as a second, fully separate instance: its own checkout, port,
service, environment file and hostname. It must never share a value with
production.

| | Production | Staging |
|---|---|---|
| Releases | `/srv/polimatiq/releases` | `/srv/polimatiq-staging/releases` |
| Port | `127.0.0.1:3000` | `127.0.0.1:3001` |
| Service | `polimatiq` | `polimatiq-staging` |
| Env file | `/etc/polimatiq/prod.env` | `/etc/polimatiq/staging.env` |
| Supabase | production project | staging project only |

Staging environment rules:
- Staging Supabase URL, anon key and service-role key only. Never production's.
- Newly generated `MAILBOX_ENCRYPTION_KEY`, `AI_PROVIDER_KEY_ENCRYPTION_KEY`,
  `VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY`, `TRACKING_TOKEN_SECRET`,
  `CLICK_TRACKING_TOKEN_SECRET`, `UNSUBSCRIBE_TOKEN_SECRET` and `CRON_SECRET`
  (`openssl rand -hex 32` each).
- `WARMUP_DRY_RUN=true`.
- No OAuth, Stripe, heartbeat or error-tracking variables. Razorpay only with
  Test Mode keys, if at all.
- Don't put the staging hostname in the staging project's Vault
  `cron_app_url`: staging cron routes are only ever called by hand.

The staging service is the production unit with `polimatiq-staging`
substituted, `-p 3001`, and `EnvironmentFile=/etc/polimatiq/staging.env`.
Its Caddy site must be private. Either allow only your own addresses
(simplest; IPv6 privacy addresses rotate, so allow your /64):

```caddyfile
	@outsiders not remote_ip 203.0.113.7/32 2001:db8:1234:5678::/64
	respond @outsiders "Forbidden" 403
```

or use basic auth (`sudo caddy hash-password` produces the hash; the
password itself never goes in the file):

```caddyfile
staging.your.app.hostname {
	encode zstd gzip
	header X-Robots-Tag "noindex, nofollow"

	basic_auth {
		staging <bcrypt-hash-from-caddy-hash-password>
	}

	reverse_proxy 127.0.0.1:3001 {
		header_up X-Forwarded-For {remote_host}
		header_up -X-Vercel-IP-Country
		header_up -CF-IPCountry
		header_up -X-Real-IP
	}
}
```

## Verifying region detection on the server

Run these after deploying, from the server itself.

```bash
# 1. Next is not reachable from outside, only via Caddy:
ss -ltnp | grep 3000          # expect 127.0.0.1:3000, not 0.0.0.0:3000

# 2. The database loads and resolves known addresses.
#    Expect "IN" (an Indian ISP address) then "US":
cd /srv/polimatiq/current && sudo -u polimatiq \
  env GEOIP_COUNTRY_DB_PATH=/var/lib/dbip/dbip-country-lite.mmdb node -e '
const { Reader } = require("mmdb-lib");
const r = new Reader(require("fs").readFileSync(process.env.GEOIP_COUNTRY_DB_PATH));
for (const ip of ["49.36.12.34", "8.8.8.8"]) console.log(ip, r.get(ip)?.country?.iso_code);'

# 3. The app logs a clear line if the database can't be loaded:
journalctl -u polimatiq | grep '\[geoip\]'
```

End to end:

- From a non-Indian network, the pricing section shows USD prices with no
  "Charged as ₹…" line. Sending `-H 'X-Forwarded-For: 49.36.12.34'` or
  `-H 'x-vercel-ip-country: IN'` through Caddy must not change that.
- From an Indian network or VPN exit, the pricing section shows
  "Charged as ₹… via Razorpay".
- With the database configured, the pricing section and `/billing` show the
  "IP Geolocation by DB-IP" link; on Vercel or with no database, they don't.
