"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createMailbox, deleteMailbox, updateMailbox } from "@/lib/db";
import { mailboxSchema, type MailboxInput } from "@/lib/validations/mailboxes";
import { encryptSmtpPassword } from "@/lib/crypto/smtp-secret";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form (react-hook-
// form + the same zod schema) already validated this input.

export async function createMailboxAction(input: MailboxInput) {
  const parsed = mailboxSchema.parse(input);
  if (!parsed.smtpPassword) {
    throw new Error("Enter the SMTP password to connect a mailbox.");
  }

  const user = await requireUser();
  const supabase = await createClient();

  await createMailbox(supabase, {
    user_id: user.id,
    domain_id: parsed.domainId ? parsed.domainId : null,
    email: parsed.email,
    display_name: parsed.displayName ? parsed.displayName : null,
    smtp_host: parsed.smtpHost,
    smtp_port: parsed.smtpPort,
    smtp_username: parsed.smtpUsername,
    encrypted_smtp_password: encryptSmtpPassword(parsed.smtpPassword),
    daily_limit: parsed.dailyLimit,
    warmup_enabled: parsed.warmupEnabled,
  });

  revalidatePath("/mailboxes");
  revalidatePath("/dashboard");
}

export async function updateMailboxAction(id: string, input: MailboxInput) {
  const parsed = mailboxSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await updateMailbox(supabase, user.id, id, {
    domain_id: parsed.domainId ? parsed.domainId : null,
    email: parsed.email,
    display_name: parsed.displayName ? parsed.displayName : null,
    smtp_host: parsed.smtpHost,
    smtp_port: parsed.smtpPort,
    smtp_username: parsed.smtpUsername,
    ...(parsed.smtpPassword ? { encrypted_smtp_password: encryptSmtpPassword(parsed.smtpPassword) } : {}),
    daily_limit: parsed.dailyLimit,
    warmup_enabled: parsed.warmupEnabled,
    ...(parsed.status ? { status: parsed.status } : {}),
  });

  revalidatePath("/mailboxes");
  revalidatePath("/dashboard");
}

export async function deleteMailboxAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteMailbox(supabase, user.id, id);

  revalidatePath("/mailboxes");
  revalidatePath("/dashboard");
}
