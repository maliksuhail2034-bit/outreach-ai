# Security operations: SIEM, network monitoring and the security admin console

Who this is for: whoever runs security for Polimatiq. It covers how to see
what is happening (logs, SIEM, network analysis), how to act on it (block
IPs, revoke access, remove escalated permissions), and how to build a
security admin console that still works when the main admin is unavailable
or their account is compromised.

It is written for the current production setup (see `docs/self-hosting.md`):

```
Internet ─443─▶ Caddy ─▶ 127.0.0.1:3000 next start   (Hostinger VPS, Ubuntu)
                         │
                         └─▶ Supabase (Postgres + Auth + Storage, managed)
Supabase pg_cron ─HTTPS─▶ /api/cron/*
```

Status markers used below:
- **[exists]** is already in the codebase or the server setup.
- **[to build]** is a design to implement. Each one is scoped in section 7.

---

## 1. What we need to detect

| Threat | Where it shows up | Response |
|---|---|---|
| Credential stuffing / brute force on `/login` | Caddy access log (POSTs to `/login`), `rate_limit_events` (`auth:sign_in`, `auth:sign_in_account`) | Block the IP (section 5), force a password reset for the targeted account |
| Account takeover (valid password, unusual location or device) | Supabase Auth logs (sign-ins), `audit_logs` (mailbox/API-key changes soon after a sign-in) | Revoke the user's sessions, ban the user until verified (section 6) |
| Privilege misuse (owner or admin account abused) | `audit_logs`, `security_actions` **[to build]** | Security admin de-escalates the account (section 6.4) |
| Abuse of cron/webhook endpoints | Caddy log: 401/403 on `/api/cron/*`, `/api/webhooks/*` | Block the IP; rotate `CRON_SECRET` / webhook secrets if a valid call came from an unexpected source |
| SSH attacks on the VPS | `/var/log/auth.log` | CrowdSec / fail2ban bans; key-only SSH (already required) |
| Data exfiltration (bulk lead export, scraping) | Response-size anomalies in Caddy logs, unusual Supabase query volume | Rate-limit or ban, investigate the account |
| Outbound abuse (customer spamming) | Bounce/complaint spikes (`email_events`), `job_runs` degraded runs | Pause the org's campaigns and mailboxes |
| Vulnerability scanning | Bursts of 404s / odd paths (`/.env`, `/wp-admin`) | Auto-ban via CrowdSec scenarios |

---

## 2. Log sources (what to collect)

| Source | Location | Notes |
|---|---|---|
| Caddy access log | add the `log` block below → `/var/log/caddy/access.log` (JSON) | Client IP, path, status, size, duration, user agent. The most valuable source |
| App log | `journalctl -u polimatiq` **[exists]** | Worker logs, `[send-worker]`, `[warmup-worker]`, `captureError` output |
| SSH / sudo | `/var/log/auth.log` | |
| Host firewall | `ufw` → `/var/log/ufw.log` (`sudo ufw logging medium`) | |
| Supabase Auth logs | Supabase Dashboard → Logs → Auth, or Log Drains (a paid add-on, so check your plan) | Sign-ins, failed sign-ins, password resets, token refreshes |
| Supabase Postgres logs | Dashboard → Logs → Postgres / Log Drains | Errors, slow queries. Enable `pgaudit` for DDL and role changes |
| `public.audit_logs` | DB table **[exists]** | Mailbox and API-key connects/disconnects, billing changes. Append-only for members |
| `public.rate_limit_events` | DB table **[exists]** | Every rate-limited auth and action attempt. Per-account sign-in keys are SHA-256 hashes, never raw emails |
| `public.job_runs` | DB table **[exists]** | Every cron run, including degraded ones |

Add JSON access logging to the Caddyfile:

```caddyfile
your.app.hostname {
	log {
		output file /var/log/caddy/access.log {
			roll_size 100MiB
			roll_keep 10
			roll_keep_for 720h
		}
		format json
	}
	# ... existing encode / reverse_proxy block ...
}
```

**Retention and GDPR:** IP addresses are personal data. Keep raw access logs
30 days on the server and 90 days in the SIEM, then delete or aggregate them.
State this in the privacy policy, which already describes log retention. Keep
security investigations longer only for a specific incident.

---

## 3. SIEM

### Recommendation: Wazuh (free, self-hosted), on a separate server

Wazuh combines log collection, correlation rules, file integrity monitoring,
vulnerability detection and active response (automatic IP blocking) in one
open-source package. It is the practical choice for a small team that needs
real detection without a Splunk or Elastic bill.

**Run the Wazuh manager on a second VPS, not the app server.** Two reasons:
- The app VPS is sized for Next.js (`MemoryMax=1600M`), and the Wazuh indexer
  needs 4+ GB of RAM.
- If the app server is compromised, the attacker must not be able to erase
  the evidence. Logs that leave the box can't be deleted from it.

A 4 vCPU / 8 GB VPS (for example, a second Hostinger KVM 4) is enough for this scale.

**Manager (new VPS):**

```bash
curl -sO https://packages.wazuh.com/4.x/wazuh-install.sh
sudo bash ./wazuh-install.sh -a          # all-in-one: indexer + manager + dashboard
# Note the admin password it prints. Then lock the dashboard down:
sudo ufw allow from <your office/VPN IP> to any port 443
sudo ufw allow from <app VPS IP> to any port 1514,1515 proto tcp   # agent traffic
sudo ufw enable
```

**Agent (app VPS):**

```bash
# Use the exact agent install command the dashboard shows under
# "Deploy new agent" (Linux, DEB amd64), with WAZUH_MANAGER=<manager IP>.
sudo systemctl enable --now wazuh-agent
```

Add the app's log sources to `/var/ossec/etc/ossec.conf` on the app VPS:

```xml
<localfile>
  <log_format>json</log_format>
  <location>/var/log/caddy/access.log</location>
</localfile>
<localfile>
  <log_format>journald</log_format>
  <location>journald</location>
  <filter field="_SYSTEMD_UNIT">^polimatiq.service$</filter>
</localfile>
<localfile>
  <log_format>syslog</log_format>
  <location>/var/log/ufw.log</location>
</localfile>
```

(`/var/log/auth.log` is collected by default.) Restart the agent with
`sudo systemctl restart wazuh-agent`.

### Detection rules to add (`/var/ossec/etc/rules/local_rules.xml` on the manager)

Start with these and tune the thresholds after a week of real traffic.

```xml
<group name="polimatiq,">
  <!-- Base: Caddy JSON access log entries -->
  <rule id="100100" level="0">
    <decoded_as>json</decoded_as>
    <field name="request.uri">\.+</field>
    <description>Polimatiq: Caddy access log</description>
  </rule>

  <!-- Login brute force: 15+ POSTs to /login from one IP in 2 minutes -->
  <rule id="100110" level="10" frequency="15" timeframe="120">
    <if_matched_sid>100100</if_matched_sid>
    <field name="request.method">POST</field>
    <field name="request.uri">^/login</field>
    <same_field>request.remote_ip</same_field>
    <description>Polimatiq: possible login brute force from $(request.remote_ip)</description>
    <group>authentication_failures,</group>
  </rule>

  <!-- Someone probing cron/webhook endpoints without the secret -->
  <rule id="100120" level="8">
    <if_sid>100100</if_sid>
    <field name="request.uri">^/api/(cron|webhooks)/</field>
    <field name="status">^40[13]$</field>
    <description>Polimatiq: unauthorized call to $(request.uri)</description>
  </rule>

  <!-- Vulnerability scanner signatures -->
  <rule id="100130" level="7">
    <if_sid>100100</if_sid>
    <field name="request.uri">\.env|wp-admin|wp-login|\.git/|phpmyadmin|/etc/passwd</field>
    <description>Polimatiq: scanner probe $(request.uri)</description>
  </rule>

  <!-- 5xx spike: app failing (or being attacked) -->
  <rule id="100140" level="9" frequency="30" timeframe="60">
    <if_matched_sid>100100</if_matched_sid>
    <field name="status">^5\d\d$</field>
    <description>Polimatiq: 5xx error spike</description>
  </rule>
</group>
```

### Active response: block automatically

On the manager, in `ossec.conf`, use Wazuh's built-in `firewall-drop` to ban
an IP for one hour when a brute-force or scanner rule fires:

```xml
<active-response>
  <command>firewall-drop</command>
  <location>local</location>
  <rules_id>100110,100130</rules_id>
  <timeout>3600</timeout>
</active-response>
```

### Alerts to people

Send level 10+ alerts to email or Slack: Wazuh dashboard → Server management →
Settings → Integrations, or `<integration>` blocks for Slack or a generic
webhook. **Alert on:** brute force, unauthorized cron calls, any
`security_actions` row **[to build]**, sudo use, file-integrity changes under
`/srv/polimatiq` and `/etc/polimatiq`.

### Lighter alternative

If running a second server isn't possible yet, use **Grafana Cloud (free
tier) with Grafana Alloy** on the app VPS. Ship the Caddy JSON log, journald
and auth.log there, and write LogQL alert rules equivalent to the ones above.
You get detection and off-box retention, but no active response. Pair it with
CrowdSec (section 5) for the blocking part.

---

## 4. Network analysis

### Always on: Suricata (intrusion detection)

```bash
sudo add-apt-repository ppa:oisf/suricata-stable && sudo apt update
sudo apt install suricata
sudo suricata-update                       # Emerging Threats Open ruleset
# /etc/suricata/suricata.yaml: set HOME_NET to the VPS public IP and the
# af-packet interface to the public NIC (ip -br a), then:
sudo systemctl enable --now suricata
```

- Run it in **IDS mode** (alert only) first. Only consider IPS mode after
  weeks of tuning: false positives in IPS mode drop real customer traffic.
- Point the Wazuh agent at `/var/log/suricata/eve.json` (`<log_format>json</log_format>`).
  Wazuh ships Suricata decoders.
- Budget about 300–500 MB of RAM. If the VPS can't spare it, run Suricata
  only on the SIEM box against mirrored traffic, or skip it and rely on Caddy
  logs plus CrowdSec.

### On demand: diagnosing a live issue

| Tool | Use |
|---|---|
| `ss -tunap` | Every open connection and its process: spot unexpected outbound connections |
| `sudo tcpdump -i eth0 -nn port 443 -c 200` | Raw capture. Write to file with `-w cap.pcap` and open it in Wireshark locally |
| `sudo iftop -P` / `nload` | Live bandwidth per connection: a sudden outbound spike is exfiltration or a spam burst |
| `ntopng` (optional) | Web UI for flow history. Expose it only on localhost and reach it via SSH tunnel |
| `sudo ss -tn state established '( dport = :587 or dport = :465 )'` | Outbound SMTP sessions currently open |

**Never** expose packet captures or these UIs publicly. Captures contain
customer data (including email content on port 587 before STARTTLS
negotiation fails).

---

## 5. Blocking IPs

Use layers, from fastest and most automatic to most permanent.

1. **CrowdSec** (automatic, community blocklists). Recommended in addition to,
   or instead of, Wazuh active response:
   ```bash
   curl -s https://install.crowdsec.net | sudo sh
   sudo apt install crowdsec crowdsec-firewall-bouncer-nftables
   sudo cscli collections install crowdsecurity/caddy crowdsecurity/linux crowdsecurity/http-cve
   # /etc/crowdsec/acquis.yaml: add the Caddy log
   #   filenames: [/var/log/caddy/access.log]
   #   labels: { type: caddy }
   sudo systemctl restart crowdsec
   sudo cscli decisions list            # current bans
   sudo cscli decisions add --ip 203.0.113.9 --duration 24h --reason "manual: brute force"
   sudo cscli decisions delete --ip 203.0.113.9
   ```
2. **ufw / nftables** (manual, on the box): `sudo ufw insert 1 deny from 203.0.113.0/24`.
3. **Hostinger managed firewall** (permanent, before traffic reaches the
   VPS): VPS dashboard → Security → Firewall. Use it for persistent bad
   ranges. Keep the 22/80/443 accept rules first (see `docs/self-hosting.md`).
4. **App-level blocklist** **[to build, section 7]**: an `ip_blocklist` table
   that `proxy.ts` checks. This lets a security admin block an IP from the
   console without SSH access.

**Don't block on one signal from a shared IP** (corporate NAT, mobile
carriers). For login abuse, the per-account rate limit (`auth:sign_in_account`,
15 attempts / 15 min) already stops attacks on one account from many IPs.

---

## 6. The security admin console

### 6.1 Goals

- A **security admin** can act on any account (including the main owner)
  without needing the owner's credentials and without being able to
  silently take over the platform themselves.
- Every privileged action is **logged off-box** (SIEM) and **can't be deleted**
  by the person who did it.
- Privilege is **time-bound and least-privilege**: read-only by default,
  write actions only for the role that needs them.

### 6.2 Roles

Platform-level staff roles (people who operate Polimatiq), separate from
customer organization roles:

| Role | Can | Cannot |
|---|---|---|
| `security_analyst` | View the security dashboard, sign-in history, audit logs, blocklist | Change anything |
| `security_admin` | Everything above, plus: block/unblock IPs, revoke a user's sessions, ban/unban a user, force a password reset, remove a user's elevated org role, pause an org's sending | Grant or remove platform staff roles alone (needs a second admin), read customers' email content or credentials |
| `platform_owner` | Grant/revoke staff roles (with a second approver), break-glass | Delete security logs |

Customer organization roles (**currently missing**: `organization_members`
has no `role` column, so every member is effectively the owner): add `owner`,
`admin`, `member`, enforce them in RLS, and audit-log every role change.
That has to come first if customers will have teams.

### 6.3 Data model (migration sketch)

```sql
create table public.platform_staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null check (role in ('security_analyst', 'security_admin', 'platform_owner')),
  granted_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,   -- second person
  expires_at timestamptz,                                            -- time-bound grants
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_staff_two_person check (approved_by is null or approved_by <> granted_by)
);

create table public.ip_blocklist (
  id uuid primary key default gen_random_uuid(),
  cidr inet not null,
  reason text not null,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only: no update/delete policy for anyone, including staff.
create table public.security_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,           -- 'ip_blocked', 'sessions_revoked', 'user_banned', 'role_removed', ...
  target_user_id uuid,
  target_ip inet,
  reason text not null,           -- required: every action states why
  metadata jsonb not null default '{}'::jsonb,
  prev_hash text,                 -- hash chain: tampering breaks the chain
  hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_staff enable row level security;
alter table public.ip_blocklist enable row level security;
alter table public.security_actions enable row level security;
-- Policies: select for active staff (expires_at is null or > now()) via a
-- security-definer helper is_platform_staff(min_role); NO insert/update/
-- delete policies — all writes go through Server Functions using the
-- service-role client after an explicit staff check (CLAUDE.md §8: this is
-- privileged admin tooling, the case admin.ts exists for).
```

### 6.4 What each action does (Supabase specifics)

All of these are Server Functions under `app/(security)/…`. Each one
re-checks the caller's staff role and MFA level itself (CLAUDE.md §4), writes
a `security_actions` row, and emits a structured log line the SIEM alerts on.

| Action | Implementation |
|---|---|
| Revoke all sessions of a user | `supabase.auth.admin.signOut(...)` revokes a session from its JWT. To kill *all* of a user's sessions, delete their rows from `auth.sessions` via a service-role SQL function (`delete from auth.sessions where user_id = $1`), which also invalidates their refresh tokens |
| Ban / lock a user | `supabase.auth.admin.updateUserById(id, { ban_duration: "876000h" })`. Unban with `ban_duration: "none"`. Combine with session revocation, since a ban stops new sign-ins and refreshes |
| Force password reset | Ban, revoke sessions, then send a recovery email (`auth.admin.generateLink({ type: "recovery", email })`) to the verified address |
| **De-escalate** an elevated account | Remove or downgrade their `organization_members.role` (once roles exist) or `platform_staff` row, then revoke sessions so the old JWT can't keep acting |
| Block an IP | Insert into `ip_blocklist`. `proxy.ts` checks it (in-memory cache refreshed every 60s), and a small sync job pushes it to CrowdSec (`cscli decisions add`) so the block also applies at the firewall |
| Pause an org's sending | Set its mailboxes' `status = 'paused'` and campaigns' `status = 'paused'`. The send and warmup workers already skip non-active ones |
| Rotate platform secrets | Runbook, not a button. Rotate freely: `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard), `CRON_SECRET` (also update the pg_cron dispatcher), `RAZORPAY_WEBHOOK_SECRET`/`STRIPE_WEBHOOK_SECRET` (also in the provider dashboard), `GOOGLE_OAUTH_CLIENT_SECRET`/`MICROSOFT_OAUTH_CLIENT_SECRET`. Rotating these breaks existing data: `MAILBOX_ENCRYPTION_KEY`, `AI_PROVIDER_KEY_ENCRYPTION_KEY` and `VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY` need every stored credential re-encrypted first, and `UNSUBSCRIBE_TOKEN_SECRET`, `TRACKING_TOKEN_SECRET` and `CLICK_TRACKING_TOKEN_SECRET` invalidate links in already-sent emails (see `docs/hostinger-cutover.md`). Update `/etc/polimatiq/prod.env`, then `systemctl restart polimatiq` |

### 6.5 Protecting the console itself

- **Separate route group** `app/(security)/` with its own layout that requires
  an active `platform_staff` row. Every Server Function re-checks too, because
  Server Functions are reachable by direct POST.
- **MFA required:** enable Supabase Auth MFA (TOTP) and require
  `aal2` (`supabase.auth.mfa.getAuthenticatorAssuranceLevel()`) for every
  console request.
- **Network allowlist:** in Caddy, only allow `/security*` from the security
  team's VPN or office IPs:
  ```caddyfile
  @security_outside {
  	path /security*
  	not remote_ip <vpn-ip>/32 <office-ip>/32
  }
  respond @security_outside 404
  ```
- **Two-person rule** for granting staff roles (`approved_by <> granted_by`),
  and for unbanning a `platform_owner`.
- **Break-glass account:** one `platform_owner` account whose password and
  TOTP seed are sealed offline (password manager emergency kit or a safe).
  Using it pages every other staff member.
- **The main admin can't erase the trail:** `security_actions` has no
  update/delete policy, rows are hash-chained, and they're shipped to the
  SIEM in real time. Deleting the table from the Supabase dashboard would
  still leave the SIEM copy.

### 6.6 Runbook: an admin account is compromised

1. **Contain (minutes):** a security admin bans the account and revokes all
   its sessions (6.4). If an attacker IP is known, block it.
2. **Cut its reach:** remove its elevated roles. Rotate any secret it could
   have seen (6.4, "Rotate platform secrets"). Revoke mailbox OAuth grants if
   mailboxes were touched.
3. **Investigate:** `audit_logs` and `security_actions` for the account
   since its last known-good sign-in. Supabase Auth logs for the sign-in IPs
   and user agents. Caddy logs for those IPs.
4. **Recover:** verify the real owner out-of-band, force a password reset,
   re-enroll MFA, unban.
5. **Notify:** if customer personal data was accessed, the GDPR clock starts:
   notify the supervisory authority **within 72 hours** of becoming aware
   (Art. 33), and customers (as controllers of their lead data) without undue
   delay so they can meet their own obligations. India's DPDP Act also
   requires notifying the Data Protection Board and affected people.

---

## 7. Build order

| # | Item | Effort |
|---|---|---|
| 1 | Caddy JSON access log + CrowdSec with the Caddy collection | 1 hour |
| 2 | Wazuh manager on a second VPS + agent + the rules in section 3 | ½–1 day |
| 3 | Organization roles (`owner`/`admin`/`member`) in `organization_members` + RLS + audit | 1–2 days |
| 4 | `platform_staff`, `security_actions`, `ip_blocklist` migration + RLS | ½ day |
| 5 | Security console: read-only dashboard (sign-ins, audit, blocklist) | 1–2 days |
| 6 | Console write actions (6.4), MFA gate, Caddy allowlist | 2 days |
| 7 | `proxy.ts` blocklist check + CrowdSec sync job | ½ day |
| 8 | Suricata (IDS mode) once the VPS has headroom | ½ day |
| 9 | Quarterly: restore-from-backup test, secret rotation drill, review staff grants | recurring |
