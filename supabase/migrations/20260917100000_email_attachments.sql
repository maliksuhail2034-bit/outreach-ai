-- Batch 3: PDF/image attachments a sequence step sends alongside its
-- HTML/plain-text body (lib/email/render-email.ts, Batch 1). Metadata only
-- — the file bytes themselves live in Supabase Storage's private
-- "attachments" bucket below, never in this table or in sequence_steps.body
-- (see lib/email/attachment-validation.ts for the size/type limits these
-- constraints mirror).
--
-- sequence_step_id is nullable and set after upload, not at insert time: the
-- composer (components/sequences/sequence-step-form.tsx) lets a user attach
-- a file to a step that doesn't exist yet (a brand-new "Add step" dialog has
-- no sequence_step_id until Save). uploadAttachmentAction inserts the row
-- unlinked; linkAttachmentsToStepAction sets sequence_step_id once the step
-- itself is created/updated. An attachment that's never linked (the dialog
-- was cancelled) is cleaned up client-side by
-- discardUnlinkedAttachmentsAction — see app/(app)/campaigns/[campaignId]/actions.ts.
create table public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sequence_step_id uuid references public.sequence_steps (id) on delete cascade,
  file_name text not null,
  mime_type text not null
    constraint email_attachments_mime_type_check
    check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null
    -- Mirrors MAX_ATTACHMENT_SIZE_BYTES in lib/email/attachment-validation.ts
    -- (8 MiB) — a hard DB-level backstop behind the application check, not a
    -- replacement for it (the application check runs first and returns a
    -- friendly error; this exists only so no other write path can ever
    -- insert something the app forgot to validate).
    constraint email_attachments_size_bytes_check check (size_bytes > 0 and size_bytes <= 8388608),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_attachments is 'PDF/image attachment metadata for a sequence step''s email. File bytes live in the private "attachments" Storage bucket at storage_path, keyed by this row''s id — never in this table.';
comment on column public.email_attachments.sequence_step_id is 'Null until linked to a step (see linkAttachmentsToStepAction) — an uploaded-but-not-yet-saved attachment.';
comment on column public.email_attachments.storage_path is 'Object key in the "attachments" Storage bucket, always "<user_id>/<uuid>-<sanitized file name>" — see uploadAttachmentAction.';

create index email_attachments_user_id_idx on public.email_attachments (user_id);
create index email_attachments_sequence_step_id_idx on public.email_attachments (sequence_step_id);

alter table public.email_attachments enable row level security;

-- Same direct-ownership shape as templates/campaigns (this table has its
-- own user_id column, so no join-chain policy is needed the way
-- sequence_steps' policies need one). Linking to a sequence_step_id is
-- additionally checked at the application layer (both the attachment row
-- and the target step are independently RLS-scoped to auth.uid() = the
-- caller, so cross-user linkage is structurally impossible — see
-- linkAttachmentsToStepAction).
create policy email_attachments_select_own on public.email_attachments
  for select using (auth.uid() = user_id);

create policy email_attachments_insert_own on public.email_attachments
  for insert with check (auth.uid() = user_id);

create policy email_attachments_update_own on public.email_attachments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy email_attachments_delete_own on public.email_attachments
  for delete using (auth.uid() = user_id);

create trigger email_attachments_set_updated_at
  before update on public.email_attachments
  for each row execute function public.set_updated_at();

-- Private bucket — not publicly readable. allowed_mime_types/file_size_limit
-- are a second backstop behind the application + table-level checks above,
-- same reasoning as email_attachments_size_bytes_check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  8388608,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Every object key is "<uploading-user-id>/<uuid>-<filename>" (see
-- uploadAttachmentAction) — (storage.foldername(name))[1] is that first path
-- segment, so this is the same "auth.uid() = owner" shape every other
-- table's RLS in this repo uses, just expressed against the object path
-- since storage.objects has no app-defined owner column to check directly.
-- No update policy: an uploaded attachment's file bytes are never replaced
-- in place, only deleted and re-uploaded as a new object.
create policy attachments_select_own on storage.objects
  for select using (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy attachments_insert_own on storage.objects
  for insert with check (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy attachments_delete_own on storage.objects
  for delete using (
    bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text
  );
