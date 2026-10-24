# Cutover: polimatiq.com from Vercel to the Hostinger VPS

Companion to [self-hosting.md](self-hosting.md). Every step marked
**(approval)** needs the owner's explicit go-ahead at the time.

## What does not change

The hostname stays `polimatiq.com`, so these keep working with no edits:
Google OAuth redirect URI, Razorpay webhook URL, Supabase auth Site URL and
email templates, pg_cron's Vault `cron_app_url`, and every link in emails
already sent. The production database is used in place: no migration, no
copy, no deletion.

## Required production values

| Variable | Where the original lives | How it is verified (read-only) |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Derived: `https://wxhulmbbobkfvtreaspo.supabase.co` | verifier: exact match |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API keys | verifier: JWT ref + role, then read-only queries |
| `NEXT_PUBLIC_APP_URL` | `https://polimatiq.com` (also a non-sensitive Vercel variable) | equals the canonical host |
| `MAILBOX_ENCRYPTION_KEY` | **Owner's records only** (Vercel holds it as "sensitive": unreadable) | verifier: decrypts stored mailbox ciphertexts (AES-GCM fails on a wrong key) |
| `AI_PROVIDER_KEY_ENCRYPTION_KEY` | **Owner's records only** | verifier: decrypts `ai_provider_keys` (if any rows) |
| `VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY` | **Owner's records only** | verifier: decrypts `verification_provider_keys` (if any rows) |
| `UNSUBSCRIBE_TOKEN_SECRET` | **Owner's records only** | verifier: checks unsubscribe links copied from real sent emails |
| `TRACKING_TOKEN_SECRET` | **Owner's records only** | verifier: checks open-pixel links from real sent emails |
| `CLICK_TRACKING_TOKEN_SECRET` | **Owner's records only** | verifier: checks click links from real sent emails |
| `CRON_SECRET` | Owner's records, **or** the authoritative copy in production Vault (`cron_secret`) | SHA-256 compared with Vault inside Postgres |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | Google Cloud console → Credentials | token endpoint with a dummy code: `invalid_grant` = valid client, `invalid_client` = wrong secret |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay dashboard (the secret is shown only when generated) | read-only `GET /v1/plans/{id}` returns 200 |
| `RAZORPAY_PLAN_*` (16) | Razorpay dashboard → Subscriptions → Plans | same GETs; amount, currency and period match `getPlanOffering()` |
| `RAZORPAY_WEBHOOK_SECRET` | Owner's records (Razorpay doesn't show it again) | only on the next real webhook (Razorpay webhook log shows 200) |
| `CRON_HEARTBEAT_URL_*` (8), `ERROR_TRACKING_WEBHOOK_URL` | Healthchecks dashboard / the error-tracking destination | URL format; first pings after cutover |
| `GEOIP_COUNTRY_DB_PATH` | Set once the GeoIP licence is accepted | `[geoip]` log line absent; INR shown from an Indian network |

Not set in production today (feature off, nothing to recover): `STRIPE_*`,
`MICROSOFT_OAUTH_*`. `WARMUP_DRY_RUN` must **not** be set in production.

**Never generate replacements** for the six encryption/token secrets. If one
cannot be recovered:
- `MAILBOX_ENCRYPTION_KEY`: every stored SMTP/IMAP password and OAuth refresh
  token becomes unreadable; every connected mailbox must be reconnected.
- `AI_PROVIDER_KEY_ENCRYPTION_KEY` / `VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY`:
  customers re-enter those API keys (no impact if the table is empty).
- `UNSUBSCRIBE_TOKEN_SECRET`: unsubscribe links in emails already sent stop
  working, a compliance problem.
- `CLICK_TRACKING_TOKEN_SECRET`: recipients clicking links in emails already
  sent get an error instead of the destination.
- `TRACKING_TOKEN_SECRET`: opens from earlier emails stop being recorded.

That is a decision for the owner, not a deployment default.

## Verifying secrets without changing anything

1. Write the candidate values to `/etc/polimatiq/prod.env` (root, 0600) over
   SSH, never through chat, logs or a shell `source`.
2. Copy 2-3 recent campaign emails' links (unsubscribe, a tracked link, the
   open pixel URL from "view source") into `/root/sample-links.txt`. Links
   are not secret.
3. Build a release (`self-hosting.md` → Building and releasing) and run the
   verifier from it, as `polimatiq`, with systemd loading the env file:

   ```bash
   sudo systemd-run --uid=polimatiq --gid=polimatiq \
     --working-directory=/srv/polimatiq/releases/<sha> \
     --property=EnvironmentFile=/etc/polimatiq/prod.env \
     --wait --pipe --collect \
     /usr/bin/node --no-warnings scripts/verify-prod-secrets.mts /root/sample-links.txt
   ```

   It prints PASS/FAIL per variable and never a value. Every row must be PASS
   (or UNVERIFIABLE for an empty table) before go-live.
4. **(approval: read-only query on production)** Compare `CRON_SECRET` with
   Vault, inside Postgres, so only a boolean comes back:

   ```sql
   select encode(extensions.digest(decrypted_secret, 'sha256'), 'hex') = '<sha256 printed by the verifier>' as matches,
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_app_url') as cron_app_url
   from vault.decrypted_secrets where name = 'cron_secret';
   ```

   `cron_app_url` is not secret; it must be `https://polimatiq.com`.

## Go-live checklist

Before:
- [ ] Every row of the verifier is PASS; `CRON_SECRET` matches Vault.
- [ ] GeoIP licence accepted, database installed, INR shown from an Indian network on staging.
- [ ] Privacy policy wording approved; `lastUpdated` bumped.
- [ ] `polimatiq.com` and `www` TTL lowered to 300 a day ahead **(approval: DNS)**.

Cutover:
1. Build the release; `ln -sfn` it to `/srv/polimatiq/current`.
2. `systemctl enable --now polimatiq`; `curl -fsS http://127.0.0.1:3000/api/health`
   on the server returns `database: ok`.
3. Rename `/etc/caddy/production.caddy.pending` to `production.caddy`, add
   `import production.caddy` to the Caddyfile, `caddy validate`, `systemctl reload caddy`.
4. **(approval: DNS at GoDaddy)** Change only these records; leave MX, SPF,
   DMARC, DKIM, Brevo and other TXT records and the nameservers alone:

   | Record | From | To |
   |---|---|---|
   | `polimatiq.com` A | `216.198.79.1` (Vercel) | `187.52.120.186` |
   | `www.polimatiq.com` CNAME | `…vercel-dns-017.com` | delete, then A `187.52.120.186` |
   | `polimatiq.com` AAAA (optional) | none | `2a02:4780:5e:e9a1::1` |

5. Caddy obtains the certificates on the first HTTPS request (seconds).

After (all read-only unless noted):
- [ ] `https://polimatiq.com` certificate valid; `www` redirects to the apex.
- [ ] `/api/health` 200 with `database: ok`.
- [ ] Sign in as an existing user; dashboard, campaigns and leads show existing data.
- [ ] A mailbox's "Test connection" succeeds (proves decryption plus SMTP/IMAP egress).
- [ ] An old unsubscribe link opens the confirmation page (don't confirm it).
- [ ] An old tracked link redirects to its destination.
- [ ] Billing page shows plans; INR disclosure from an Indian network. No test charge.
- [ ] Within the hour: `job_runs` rows from pg_cron and Healthchecks pings.
- [ ] `journalctl -u polimatiq -p warning` has nothing unexplained.
- [ ] Razorpay webhook log shows 200 on the next event.

## Rollback

- **App problem:** point `/srv/polimatiq/current` at the previous release
  and restart (see self-hosting.md → Rollback). Data is untouched.
- **VPS problem:** restore the two DNS records above. This only helps once
  the Vercel project is serving again (it currently returns 402).
- Nothing in the cutover writes to the database or changes a secret, so no
  data rollback is ever needed.
