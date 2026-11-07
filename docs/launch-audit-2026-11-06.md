# Launch-readiness review — 6 November 2026

Branch `fix/launch-readiness`. This records what was changed, what was
checked and found fine, what still needs a decision, and how to deploy it.

**Verification done:** `npm run typecheck`, `npm run lint`, `npm test`
(2,473 tests, 162 files, all passing, including 40+ new ones) and
`npm run build` all pass.

**Not done:** no click-through of the running app. This worktree has no
`.env.local` and Docker isn't running, so there was no local Supabase stack.
The pgTAP database tests (`supabase test db`) weren't run either. Both should
happen on staging before production (see "Deploy" below).

---

## 1. Changes

### Sign-up, login, reset password
- **Password rules are always shown** between "Password" and "Confirm
  password", ticked off live as the user types (icon + text, not color only).
  The list comes from the same `PASSWORD_RULES` the server validates against,
  so the UI and the server can't disagree.
- **Nothing gets wiped on an error.** React 19 resets a form after every
  `action` submission, which is why a rejected password cleared the name and
  email too. The forms are now controlled and submit through the action
  dispatcher. Login keeps the email and clears only the password.
- Mismatched or weak passwords are caught in the browser before the server
  round trip. A live "Passwords match" hint and a show/hide toggle are added.
  The server reports every unmet rule, not just the first, and caps passwords
  at 72 characters (bcrypt's limit).

### Name from sign-up → profile
- **Root cause:** the name was stored only in Supabase Auth `user_metadata`.
  Nothing ever created the `profiles` row, so Settings showed an empty name.
- **Fix:** `/auth/confirm` creates the profile from the sign-up name (and the
  browser's timezone) on first confirmation. It is insert-only, so it never
  overwrites an edited profile. Users who confirmed before this change get the
  same seed the first time they open the dashboard. Settings and the app shell
  also fall back to the sign-up name. Metadata is treated as untrusted:
  type-checked, length-capped, and the timezone restricted to the picker's list.

### Analytics page
Problems found:
1. The date-range buttons drove only a section that read `analytics_events`,
   a table **nothing writes to**, so they never changed anything.
2. The campaign table sent every enrolled lead id in one request URL. Past a
   few hundred leads, that URL is too long and **the whole page fails**.
3. Charts were built from the latest 500 send attempts only, so busy accounts
   saw truncated data.
4. "All-time" totals come from a nightly rollup, so they never include today.
5. No open, click or unsubscribe rates, no previous-period comparison, and
   everything rendered in UTC.

Now:
- Two `SECURITY INVOKER` SQL functions aggregate the selected range in
  Postgres, so RLS still applies and the page fetches a few dozen rows
  whatever the volume.
- Range buttons (Today / 7 / 30 / 90 days, in the **user's own timezone**)
  drive these cards: emails sent, leads contacted, reply rate, open rate,
  click rate, bounce rate, unsubscribes and failed sends. Each shows the change
  vs. the previous period, colored correctly for "lower is better" metrics.
- Daily charts for sends, replies, opens and failures.
- A per-campaign table for the range.
- A note that opens are inflated by Apple Mail Privacy Protection.
- The expensive all-time section streams in separately (Suspense + error
  boundary), so the main numbers show first and a failure there doesn't blank
  the page.

### Sending engine
Already strong: idempotent send claims, leases, one send at a time per
mailbox, a capped retry ladder, per-lead timezone windows, suppression
re-checks, RFC 8058 one-click unsubscribe, and bounce classification.

Changes:
- **Throughput:** each run claimed at most 25 leads (one per mailbox), capping
  the *whole platform* at about 25 emails a minute. The default is now 100
  claims and 10 parallel mailboxes. Both are tunable with
  `SEND_WORKER_CLAIM_LIMIT` / `SEND_WORKER_CONCURRENCY` (documented in
  `docs/self-hosting.md`).
- **Query cost:** `claimable_due_sends()` runs up to four times a minute and
  counted every "sent" event ever recorded. It now computes usage only for
  mailboxes and campaigns with something due, using indexed lookups. It also
  adds partial indexes for in-flight leases.
- **Human-like pacing:** the gap between sends now gets 0–50% random jitter on
  top of the cooldown. New mailboxes default to a 5-minute cooldown instead of
  0, so they no longer burst out their whole hourly limit in a few minutes.
  Daily and hourly limits are unchanged. Existing mailboxes keep their current
  cooldown: consider raising any that are at 0.
- **OAuth token reuse:** Gmail and Outlook access tokens were refreshed on
  every send and every IMAP poll. They're now cached in memory until 5
  minutes before expiry and dropped on an AUTH rejection.
- **Fewer DB round trips:** the campaign, sequence steps and owner settings
  are read once per run per campaign, not once per lead.
- **Header bug:** a sender or lead name containing `"` produced a malformed
  `From`/`To` header. Addresses now go to nodemailer as objects, so names are
  quoted and encoded properly and CR/LF is stripped.

### Warmup
Already real: peer-to-peer sending between the organization's mailboxes,
ramp-up, randomized timing, reply threading, auto-pause on failures.

Gaps vs. Instantly/Lemlist, now fixed:
- **Spam rescue:** it only ever looked in the INBOX, so warmup mail filed as
  spam was never found, never pulled out and never counted. The new inbox
  agent (`lib/warmup/inbox-agent.ts`) searches the spam/junk folder by exact
  Message-ID and moves our warmup mail back to the inbox, the "not spam"
  signal that rebuilds reputation.
- **Engagement:** arrivals are marked read and about 25% are starred.
- **Inbox placement metric:** placement is recorded per message. The daily
  stats now fill `spam_rate` plus inbox/spam counts, the warmup score weighs
  placement, and the dashboard shows "% inbox", a 7-day summary, and warnings
  under 80% inbox or when IMAP is off.
- **Lighter polling:** it downloaded every new INBOX email's full source (real
  customer mail included) and ran one DB lookup per message. It now fetches
  envelopes only, does one batched lookup, and never touches non-warmup mail.
- **Content variety:** 6 fixed bodies became messages composed from parts
  (greeting × opener × body × sign-off × subject, with first names), so there
  are thousands of distinct combinations. HTML is escaped.
- Fixed the dashboard's "next increase" date, which used a different anchor
  than the worker.

**Still a gap (a product decision, not a bug):** Instantly and Lemlist warm up
across a **shared network** of thousands of inboxes. Polimatiq warms up only
between mailboxes of the *same organization*. With 1–2 mailboxes there's
little or no peer pool, and a single mailbox can't warm up at all. A
cross-customer pool needs explicit opt-in consent in the Terms, content rules,
and per-org rate caps.

### Security hardening
- Per-account sign-in rate limit (15 per 15 minutes, keyed by a SHA-256 of the
  email) on top of the per-IP limit. This stops distributed brute force
  against one account (OWASP A07).
- New response headers: a safe CSP subset (`frame-ancestors 'none'`,
  `base-uri 'self'`, `object-src 'none'`), `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`, and `X-Permitted-Cross-Domain-Policies`. The
  `X-Powered-By` header is removed.
- `proxy.ts` no longer calls Supabase Auth for visitors without a session
  cookie, which removes an Auth API round trip from every marketing page view.

---

## 2. OWASP Top 10 (2021) status

| | Status | Notes |
|---|---|---|
| A01 Broken access control | **Good / one gap** | RLS on every table. Server Functions re-check auth. Cron uses a shared secret, webhooks are signed. **Gap:** no organization roles, so every member is effectively owner. Needed before team seats (see `docs/security-operations.md` §6.2) |
| A02 Cryptographic failures | Good | Mailbox, AI-key and verification-key secrets encrypted at rest. HSTS preload. Signed unsubscribe/tracking tokens |
| A03 Injection | Good | PostgREST/parameterized RPCs. Merge tags HTML-escaped. New warmup HTML escaped. Header injection via names closed (above) |
| A04 Insecure design | Good | Idempotent sends, fail-closed billing currency, append-only audit logs |
| A05 Security misconfiguration | **Improved** | Headers above, `poweredByHeader: false`. A full script-src CSP still needs the origin catalogue (Razorpay, Stripe, OAuth) |
| A06 Vulnerable components | Action | Run `npm audit` and enable Dependabot or Renovate on the GitHub repo |
| A07 Identification & auth failures | **Improved** | Per-IP + per-account limits, generic credential errors, enumeration-safe reset. **Recommended:** offer TOTP MFA (Supabase supports it) and require it for staff |
| A08 Software & data integrity | Good | Webhook signatures verified. Builds run without production secrets in the install step |
| A09 Logging & monitoring failures | **Partial** | `job_runs`, `audit_logs`, error webhook, Healthchecks. Logs aren't centralized off-box and there's no alerting on auth abuse yet: follow `docs/security-operations.md` |
| A10 SSRF | Good | SMTP/IMAP hosts and webhook URLs resolved and refused if private; webhook redirects not followed |

---

## 3. Compliance by market (GRC)

Polimatiq is a **processor** for its customers' lead data, and a
**controller** for its own customers' account data. Customers are the
senders and carry the consent and lawful-basis duties for their campaigns.
The platform's job is to make compliance the default and to make
non-compliance hard. *This is engineering guidance, not legal advice. Have
counsel review the DPA and Terms before an EU launch.*

| Market | Rules that matter for cold email | Platform status |
|---|---|---|
| **EU (GDPR + ePrivacy)** | B2B cold email usually relies on legitimate interest (Art. 6(1)(f)) with a balancing test. Art. 14: tell the recipient where their data came from, at the latest in the first email. Easy objection (Art. 21). Germany (UWG §7) and some others effectively require prior consent even for B2B. Tracking pixels fall under ePrivacy Art. 5(3) (EDPB Guidelines 2/2023) | Unsubscribe + suppression ✅ (one-click, honored at claim *and* send time). Retention worker ✅. Privacy policy lists data rights ✅. **Gaps:** (1) offer a **DPA (Art. 28)** and a **sub-processor list** (Supabase, Hostinger, Google/Microsoft, AI providers) on the site; (2) let customers **turn off open/click tracking per campaign** for EU recipients (today it's one account-wide toggle); (3) add an optional "why you're receiving this / data source" footer line to support Art. 14 |
| **UK (UK GDPR + PECR)** | Like the EU. PECR allows B2B email to corporate subscribers; sole traders need consent | Same as EU |
| **US (CAN-SPAM)** | Truthful headers and subject, ad identification, **a valid physical postal address in every email**, opt-out honored within 10 business days | Opt-out ✅ (instant). **Gap:** no postal-address setting, and the footer doesn't include one. Add a required "Sender postal address" to Settings and append it to the compliance footer, the same way the unsubscribe link is enforced |
| **Canada (CASL)** | Express or implied consent required. Cold email to a conspicuously published business address is allowed only when it's relevant to the role. Sender ID + unsubscribe in every message | Unsubscribe ✅. Same postal-address gap. Acceptable Use should spell out the consent requirement |
| **Australia (Spam Act 2003)** | Consent (inferred for conspicuously published role addresses), sender identification, functional unsubscribe | ✅ with the postal/sender identification gap above |
| **India (DPDP Act 2023)** | Notice + consent-based processing, data principal rights, breach notification to the Board | Razorpay/INR flow ✅. Breach runbook in `docs/security-operations.md` §6.6 |
| **Gmail / Yahoo bulk-sender rules** | SPF + DKIM + DMARC, one-click unsubscribe (RFC 8058), spam complaints under 0.3% | One-click ✅. DNS checks on the deliverability page ✅. Keep enforcing the bounce/complaint auto-pause |

**International transfers:** confirm the Supabase project's region and the
VPS location. For EU personal data stored outside the EEA, rely on the EU–US
Data Privacy Framework or SCCs, and name the region in the privacy policy.

---

## 4. Performance and capacity notes
- The marketing home page `/` renders dynamically per request (it detects the
  billing region for the INR note). That's fine at current traffic. If it
  becomes hot, make the page static and move the region-dependent line into a
  small streamed component.
- `next start` is a single Node process. On a multi-core VPS, run 2 instances
  behind Caddy (`reverse_proxy` with two upstreams) before reaching for a
  bigger box. The access-token cache is per process, which is fine.
- The all-time analytics section still loads one snapshot per campaign,
  mailbox and domain. It now streams separately, but an organization with
  hundreds of campaigns should move it to the nightly rollup tables.

---

## 5. Deploy

1. **Migrations** (new, not applied anywhere yet). Apply to **staging first**:
   - `20261106100000_analytics_range_metrics.sql`: two read-only functions + one partial index
   - `20261106100100_claimable_due_sends_scalable_pacing.sql`: replaces `claimable_due_sends()` (same signature) + two partial indexes
   - `20261106100200_warmup_inbox_placement.sql`: new nullable columns on `warmup_messages`, counters on `warmup_stats`

   Then run `supabase test db` against staging or local (the pgTAP suite
   pins claim behavior), and check that the send-emails cron keeps sending.

   **Order matters:** apply the migrations **before** deploying the app. The
   new analytics page and warmup worker read the new functions and columns.
2. **Env (optional):** `SEND_WORKER_CLAIM_LIMIT`, `SEND_WORKER_CONCURRENCY`.
3. **On staging, click through:**
   - sign up with a wrong confirm password (fields kept, rules visible), then
     confirm via email and check the name appears in Settings;
   - each analytics range;
   - the warmup page with an IMAP-enabled mailbox, then one warmup cycle
     (`WARMUP_DRY_RUN=true` first, to see the placements it would record);
   - send one campaign email to a Gmail and an Outlook inbox.
4. **Existing mailboxes:** review any with `cooldown_minutes = 0` and consider 5+.
