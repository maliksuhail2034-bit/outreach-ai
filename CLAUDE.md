@AGENTS.md

# outreach-ai — Engineering Guide

This file is the source of truth for how this codebase is organized and how work
should be done in it. Read it before making changes. It is a living document —
keep it in sync with reality as the project grows.

> **Next.js version note:** see `AGENTS.md` (imported above) — this project pins
> a Next.js version that has breaking changes from what you may know from
> training data. Check `node_modules/next/dist/docs/` before relying on
> remembered API shapes (e.g. Server Actions/Server Functions terminology,
> `use cache` / Cache Components, async `cookies()`).

## 1. What this SaaS is

**outreach-ai** is an AI SDR (Sales Development Representative) platform. It
finds, qualifies, and engages leads on behalf of a sales team across channels
(email today, with room for LinkedIn/other channels later), using AI to
personalize outreach and to score/qualify prospects before a human ever gets
involved.

Core domain concepts to expect as the product grows: **organizations/accounts**
(the paying customer), **users** (members of an org, with roles), **leads /
prospects**, **campaigns / sequences**, **messages** (individual outbound
touches and inbound replies), and **AI qualification / scoring** on top of
those. Multi-tenancy (one org's data must never be visible to another org) is
a first-class concern from day one — see [Database Conventions](#7-database-conventions).

## 2. Current state of the codebase

Be honest about this in any planning: as of now, the app is a wired-up
skeleton, not a built product.

- Implemented: Next.js App Router scaffold, Tailwind v4 styling pipeline,
  TypeScript strict mode, ESLint, and a Supabase credential/client layer
  (`lib/supabase/{client,server,admin}.ts`) that reads all secrets from
  environment variables.
- Not yet implemented: authentication/session flow, any domain data model,
  any route beyond the default `/`, and all product UI.

Do not assume domain features (auth pages, campaign builder, lead lists, etc.)
exist just because they're described above — check the `app/` tree first.

## 3. Technology stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router), Turbopack |
| UI runtime | React 19 (Server Components by default) |
| Language | TypeScript, `strict: true` |
| Styling | Tailwind CSS v4 (CSS-first config via `@theme` in `app/globals.css`) |
| Fonts | `next/font/google` (Geist Sans / Geist Mono) |
| Database / Auth / Storage | Supabase (Postgres, Row Level Security, Supabase Auth) |
| Supabase SDKs | `@supabase/supabase-js`, `@supabase/ssr` |
| Linting | ESLint 9 flat config (`eslint-config-next`) |
| Package manager | npm (`package-lock.json` is committed — don't switch package managers) |

Do not introduce a second UI framework, CSS-in-JS library, ORM, or auth
provider without an explicit decision to do so — the stack above is the
default for every feature.

## 4. Project architecture

- **Rendering model**: Next.js treats static vs. dynamic as a per-component
  spectrum, not a per-route toggle (Partial Prerendering, Cache Components /
  `use cache`, on-demand revalidation). Default to Server Components; reach
  for a static shell + streaming dynamic sections instead of making a whole
  route dynamic just because one piece of it needs fresh data.
- **Data flow**:
  - Reads happen in Server Components via `lib/supabase/server.ts` (cookie-scoped,
    RLS-enforced) wherever possible.
  - Writes happen via Server Functions (`'use server'`) — colocate them as
    `actions.ts` next to the route/feature that owns them — or Route Handlers
    when you need a real HTTP endpoint (webhooks, third-party callbacks).
  - Server Functions are reachable directly via POST, independent of your UI.
    **Every Server Function must re-check auth/ownership itself** — never rely
    on the calling UI having already gated access.
  - Client Components exist only for interactivity (forms with local state,
    optimistic UI, event handlers). They call Server Functions; they never
    talk to Supabase directly with privileged credentials.
- **Multi-tenancy**: every domain query is implicitly scoped to the caller's
  organization via RLS policies (see §7), not via manual `WHERE org_id = ...`
  filtering alone. Manual filtering is a UX/perf nicety, RLS is the actual
  security boundary.
- **AI/agent work**: keep model calls and prompt construction in server-only
  modules under `lib/ai/` (never in Client Components, never in code that
  could ship an API key to the browser). Treat AI output as untrusted input —
  validate/sanitize before using it to drive side effects (sending an email,
  writing to the DB).

## 5. Folder structure

Current layout:

```
app/                  # Routes only (App Router). Pages, layouts, route handlers.
  globals.css
  layout.tsx
  page.tsx
lib/
  supabase/
    client.ts         # Browser client — anon key only
    server.ts          # Server Component/Action client — anon key, cookie-scoped
    admin.ts           # Service-role client — server-only, privileged
public/                # Static assets served verbatim at the root URL.
                       # NEVER put secrets or env files here — see §8.
```

Target structure as the product grows (introduce folders as they're needed,
don't scaffold speculatively):

```
app/
  (marketing)/          # Public marketing/landing routes, own layout
  (app)/                # Authenticated product routes, own layout + auth guard
    dashboard/
    leads/
    campaigns/
      [campaignId]/
        actions.ts       # Server Functions for this route, colocated
        page.tsx
  api/                  # Route Handlers for webhooks/third-party callbacks only
  auth/                 # Supabase auth callback route, login/signup pages
components/
  ui/                   # Small, generic, reusable presentational components
  <feature>/             # Feature-specific components (e.g. components/leads/)
lib/
  supabase/              # As above
  ai/                    # Model calls, prompt construction (server-only)
  validations/           # Shared zod (or similar) schemas for input validation
  utils.ts
types/                   # Shared TypeScript types not colocated with a feature
supabase/
  migrations/            # Supabase CLI migrations (source of truth for schema)
```

Rules:
- Route folders under `app/` contain only what defines the route (`page`,
  `layout`, `loading`, `error`, `route`, colocated `actions.ts`). Anything
  reusable across routes goes in `components/` or `lib/`.
- Prefix non-routable folders colocated inside `app/` with `_` (e.g.
  `app/(app)/leads/_components/`) so they're never mistaken for routes.
- Never add a second "kitchen sink" `utils.ts` per feature — put shared logic
  in `lib/`, feature-only helpers next to the feature.

## 6. Coding standards

- **TypeScript strict, no `any`.** If a type is genuinely unknown, use
  `unknown` and narrow it. `tsconfig.json` already has `strict: true` — don't
  weaken it.
- **Server Components by default.** Only add `'use client'` when you need
  interactivity, browser-only APIs, or hooks (`useState`, event handlers,
  etc.). Push `'use client'` as far down the tree as possible — don't mark a
  whole page client just because one small piece needs it.
- **Path alias**: import via `@/*` (e.g. `@/lib/supabase/server`), not deep
  relative paths (`../../../lib/...`).
- **Naming**: `kebab-case` for filenames, `PascalCase` for React component
  names/exports, `camelCase` for functions and variables, `SCREAMING_SNAKE_CASE`
  only for true constants/env var names.
- **No dead code, no speculative abstraction.** Don't build a generic
  "provider/adapter" layer for a single use case. Three similar lines beat a
  premature abstraction — see the general engineering guidance you already
  follow.
- **Validate at boundaries.** Every Server Function and Route Handler that
  accepts external input (form data, webhook payloads, AI output used for a
  mutation) validates it before touching the database — don't trust the
  client or a third party.
- **Errors**: throw in Server Functions/Route Handlers for actual failures;
  let Next's `error.tsx` boundaries and `notFound()` handle presentation.
  Don't swallow errors silently.
- **Comments**: only when the *why* isn't obvious from the code (a workaround,
  a non-obvious constraint). Don't narrate *what* the code does.

## 7. UI guidelines

- **Styling**: Tailwind utility classes only. Theme tokens are defined in
  `app/globals.css` via `@theme inline` (`--color-background`,
  `--color-foreground`, font variables) — use the generated `bg-background` /
  `text-foreground` utilities (and add new tokens the same way) instead of
  hardcoding hex colors in components.
- **Dark mode**: already wired via `prefers-color-scheme` in `globals.css`.
  Any new color token must define both a light and dark value; any new
  component must look correct in both without extra per-component dark-mode
  code.
- **Fonts**: use the existing `--font-geist-sans` / `--font-geist-mono`
  variables already set up in `app/layout.tsx`. Don't import additional font
  families without a reason.
- **Images**: always `next/image`, never a raw `<img>`.
- **Components**: small, composable, presentational components in
  `components/ui/`; feature components that know about domain data live next
  to the feature (`components/<feature>/` or colocated under the route).
- **Accessibility**: semantic HTML first (`button` for actions, `a`/`Link`
  for navigation), visible focus states, label every form input, no
  color-only signal (pair with icon/text).
- **Responsive by default**: mobile-first Tailwind breakpoints; test at
  narrow widths, not just desktop.

## 8. Database conventions

Postgres via Supabase. Schema is managed through **Supabase CLI migrations**
under `supabase/migrations/` — the migration history is the source of truth,
never hand-edit schema directly against a live project.

- **Naming**: `snake_case` for tables and columns, tables named plural
  (`leads`, `campaigns`, `messages`), join tables named
  `<a>_<b>` (`campaign_leads`).
- **Every table** gets: `id uuid primary key default gen_random_uuid()`,
  `created_at timestamptz not null default now()`, and `updated_at timestamptz
  not null default now()` (kept current via a trigger, not app code).
- **Multi-tenancy column**: any table holding org-owned data has an
  `organization_id uuid not null references organizations(id) on delete cascade`
  column, indexed.
- **Row Level Security is mandatory.** Enable RLS on every new table in the
  same migration that creates it, with explicit policies scoping rows to the
  caller's organization (and role, where relevant). A table with RLS disabled
  or with an overly-broad policy is a bug, not a shortcut.
- **Access pattern**:
  - Default: `lib/supabase/server.ts` (anon key, user's session, RLS
    enforced) for all reads/writes triggered by a user.
  - `lib/supabase/admin.ts` (service role, bypasses RLS) is reserved for
    genuinely privileged server-only work with no user in the loop (webhooks,
    scheduled jobs, admin tooling) — never use it to "work around" an RLS
    policy that's blocking a normal user flow. If RLS is blocking a legitimate
    user action, fix the policy.
  - Never import `lib/supabase/admin.ts` from a Client Component or from any
    module reachable by client bundling.
- **Foreign keys** are always explicit with an `on delete` behavior chosen
  deliberately (`cascade` for owned child rows, `restrict`/`set null`
  otherwise) — no implicit orphaned rows.

## 9. Git workflow

- **Branching**: work off short-lived feature branches from `main`
  (`feat/lead-scoring`, `fix/campaign-timezone`, `chore/upgrade-supabase`).
  Don't commit directly to `main`.
- **Commits**: small and scoped, written in imperative mood, explaining *why*
  when the *what* isn't obvious from the diff (e.g. `Add RLS policy for
  campaign_leads to fix cross-org leak`, not `update db`).
- **Before opening a PR**: run the full check sequence in §10 locally.
- **PRs**: describe the change and the reasoning, not just a restatement of
  the diff; call out schema changes and any new environment variables
  explicitly so they don't get missed during deploy.
- **Never commit secrets.** `.env.local` and friends are git-ignored (see
  `.gitignore`) — if a check ever shows a credential staged, stop and ask
  before committing. See `.env.example` for the current required variables.
- **Never rewrite shared history** (`push --force`, `rebase` on pushed
  branches) without explicit confirmation.

## 10. How every future feature should be implemented

Follow this sequence for any new feature, big or small:

1. **Schema first, if the feature touches data.** Write a Supabase migration
   under `supabase/migrations/`: tables/columns per §8, RLS enabled with
   policies in the same migration. No feature ships with data behind
   permissive or missing RLS.
2. **Types.** Derive/define TypeScript types for the new data shape (colocate
   with the feature, or `types/` if genuinely shared).
3. **Data access.** Add read/write functions using `lib/supabase/server.ts`
   (or `admin.ts` only if §8's criteria are met). Validate all external input
   at this boundary.
4. **Routes and Server Functions.** Build the route under `app/(app)/...` (or
   the appropriate group). Server Components fetch and render; mutations are
   Server Functions in a colocated `actions.ts`, each independently checking
   auth/ownership.
5. **UI.** Compose from `components/ui/` primitives per §7; add
   feature-specific components colocated with the feature. Client Components
   only where interactivity requires it.
6. **Loading/error states.** Add `loading.tsx`/`error.tsx` where a route does
   real async work, instead of ad hoc spinners scattered in components.
7. **Revalidate.** After a mutation, call `revalidatePath`/`revalidateTag` (or
   `refresh()` for a lightweight UI refresh) so the UI reflects the new state
   — don't rely on a full page reload.
8. **Verify before calling it done** — see §11. Never skip this.

If a feature doesn't fit this shape (e.g. a pure static marketing page), skip
the steps that don't apply, but still finish with §11.

## 11. Required checks — always run before completing any task

Run all three, in order, before considering *any* task finished — bug fix,
feature, refactor, or config change:

```bash
npm run typecheck
npm run lint
npm run build
```

Fix any failure they report; do not report a task as complete with any of
these red. If a failure is pre-existing and unrelated to your change, say so
explicitly rather than silently ignoring it.
