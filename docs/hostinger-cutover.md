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
| `CLICK_TRACKING_LEGACY_BEFORE` | New: the cutover instant (ISO 8601, UTC), set only when `CLICK_TRACKING_TOKEN_SECRET` is a new value | an old tracked link redirects; see below |

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
  sent get an error instead of the destination — unless
  `CLICK_TRACKING_LEGACY_BEFORE` is set (below).
- `TRACKING_TOKEN_SECRET`: opens from earlier emails stop being recorded.
  The pixel still loads; nothing breaks for recipients.

That is a decision for the owner, not a deployment default.

### Old click links after a new `CLICK_TRACKING_TOKEN_SECRET`

With `CLICK_TRACKING_LEGACY_BEFORE` set to the cutover instant,
`lib/email/legacy-click-token.ts` honours a click link whose signature no
longer verifies only if, from the database: the email was actually sent
(`send_attempts.status = 'sent'`) before that instant, the enrollment
matches the link's campaign and lead, the step belongs to that campaign, and
re-rendering the stored step for that lead produces exactly that link. A
forged link can therefore only reach a URL the sender put in an email that
was sent. Links signed with the current secret never take this path. The
click is recorded with `metadata.legacyToken = true`, so its use can be
measured and the variable removed once it stops appearing. If the step was
edited after sending, its old links are rejected (fail closed).

### Old unsubscribe links

There is no equivalent fallback: current unsubscribe tokens are encrypted
with a key derived from `UNSUBSCRIBE_TOKEN_SECRET`, so without it an old
token cannot even be read. An unverifiable link shows "Link no longer valid"
with a `mailto:` to the support address, changes nothing, and logs
`[unsubscribe] link could not be verified` (format only). After go-live,
any of those log lines for links sent before cutover means the secret
was wrong: `journalctl -u polimatiq | grep "could not be verified"`.

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
4. **(approval: read-only query on production)** Fingerprint Vault's
   `cron_secret` in the Supabase dashboard's SQL editor (no CLI, so no
   temporary login role), so only 12 hex characters come back:

   ```sql
   select name,
          case when name = 'cron_app_url' then decrypted_secret
               else left(encode(extensions.digest(decrypted_secret, 'sha256'), 'hex'), 12) end as value_or_fp,
          case when name = 'cron_secret'
               then left(encode(extensions.digest(btrim(decrypted_secret), 'sha256'), 'hex'), 12) end as fp_trimmed,
          length(decrypted_secret) as length
   from vault.decrypted_secrets where name in ('cron_app_url', 'cron_secret');
   ```

   `cron_app_url` is not secret; it must be `https://polimatiq.com`. The
   fingerprints are the first 12 hex characters of SHA-256, the same scheme
   as the local candidates. `value_or_fp` equal to the candidate's: Vault
   holds exactly that value. Only `fp_trimmed` equal: same value plus
   surrounding whitespace, which pg_cron sends verbatim, so the app's value
   must include it too (or Vault is rewritten). Neither: a different secret.

### Cron: gated start

pg_cron reads `cron_app_url`/`cron_secret` from Vault on every call and
`send-emails` runs every minute, so the moment DNS points at an app whose
`CRON_SECRET` matches Vault, the campaign backlog paused since the outage
starts sending, and warmup resumes. Don't let that happen implicitly:

1. Go live with `CRON_SECRET` set to a fresh random value. Every pg_cron call
   gets 401; nothing runs, nothing is written (`runCronJob` rejects before
   recording a run). Healthchecks keeps alerting, as it has since the outage.
2. Check the app (After, below) without any job running.
3. **(approval: resume jobs)** Either
   - the Vault fingerprint matched the known candidate: put that value in
     `CRON_SECRET` and `systemctl restart polimatiq`. No production write; or
   - it didn't: set Vault to the fresh value in the SQL editor,
     `select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<value>');`
     (a production write). The app already holds that value, so there is no
     window where the two disagree.
4. Within a few minutes `job_runs` gets rows and the heartbeats turn green.
   To stop everything again, put a fresh value back in `CRON_SECRET` and
   restart.

Test the routes without running a job: `curl -X POST -H "Authorization: Bearer wrong"
https://polimatiq.com/api/cron/send-emails` must return 401.

## Go-live checklist

Before:
- [ ] Mailbox key PASS; every other secret PASS, or its fallback above accepted.
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
- [ ] An old tracked link redirects to its destination (needs `CLICK_TRACKING_LEGACY_BEFORE` if the secret is new).
- [ ] Billing page shows plans; INR disclosure from an Indian network. No test charge.
- [ ] Cron routes return 401 to a wrong secret. After the approved resume: `job_runs` rows and Healthchecks pings.
- [ ] `journalctl -u polimatiq -p warning` has nothing unexplained.
- [ ] Razorpay webhook log shows 200 on the next event.

## Rollback

- **App problem:** point `/srv/polimatiq/current` at the previous release
  and restart (see self-hosting.md → Rollback). Data is untouched.
- **VPS problem:** restore the two DNS records above. This only helps once
  the Vercel project is serving again (it returns 402 while the account is
  over its limit), so today the practical fallback is the previous VPS
  release, or stopping `polimatiq` (the site is down either way, as now).
- **Jobs misbehave after resume:** set a fresh `CRON_SECRET` and restart;
  every pg_cron call then gets 401 until fixed.
- Nothing in the cutover writes to the database or changes a secret, so no
  data rollback is ever needed.
