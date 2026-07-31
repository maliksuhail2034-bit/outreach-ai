"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createMailbox, deleteMailbox, getMailboxImapCredential, updateMailbox } from "@/lib/db";
import { mailboxSchema, type MailboxInput } from "@/lib/validations/mailboxes";
import { encryptSmtpPassword } from "@/lib/crypto/smtp-secret";
import { ImapReplyChecker } from "@/lib/email/reply-providers/imap";
import type { Tables } from "@/types/database.types";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form (react-hook-
// form + the same zod schema) already validated this input.

export async function createMailboxAction(input: MailboxInput) {
  const parsed = mailboxSchema.parse(input);
  if (!parsed.smtpPassword) {
    throw new Error("Enter the SMTP password to connect a mailbox.");
  }
  if (parsed.imapEnabled && (!parsed.imapHost || !parsed.imapUsername || !parsed.imapPassword)) {
    throw new Error("Enter the IMAP host, username, and password to enable reply tracking.");
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
    reply_provider: "imap",
    imap_enabled: parsed.imapEnabled,
    imap_host: parsed.imapHost ? parsed.imapHost : null,
    imap_port: parsed.imapPort,
    imap_username: parsed.imapUsername ? parsed.imapUsername : null,
    ...(parsed.imapPassword ? { encrypted_imap_password: encryptSmtpPassword(parsed.imapPassword) } : {}),
  });

  revalidatePath("/mailboxes");
  revalidatePath("/dashboard");
}

export async function updateMailboxAction(id: string, input: MailboxInput) {
  const parsed = mailboxSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  if (parsed.imapEnabled && (!parsed.imapHost || !parsed.imapUsername)) {
    throw new Error("Enter the IMAP host and username to enable reply tracking.");
  }
  if (parsed.imapEnabled && !parsed.imapPassword) {
    const existing = await getMailboxImapCredential(supabase, user.id, id);
    if (!existing?.encrypted_imap_password) {
      throw new Error("Enter the IMAP password to enable reply tracking.");
    }
  }

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
    reply_provider: "imap",
    imap_enabled: parsed.imapEnabled,
    imap_host: parsed.imapHost ? parsed.imapHost : null,
    imap_port: parsed.imapPort,
    imap_username: parsed.imapUsername ? parsed.imapUsername : null,
    ...(parsed.imapPassword ? { encrypted_imap_password: encryptSmtpPassword(parsed.imapPassword) } : {}),
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

const TEST_CONNECTION_TIMEOUT_MS = 10_000;

export interface TestImapConnectionInput {
  mailboxId?: string;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapPassword: string;
}

// Live IMAP login check, independent of the reply-sync worker. Reuses
// ImapReplyChecker exactly as Phase 1 built it (zero changes to
// lib/email/reply-providers/imap.ts) by feeding it a placeholder mailbox row
// with imap_last_uid/imap_uid_validity left null — that forces the "never
// synced" branch (connect, SELECT INBOX, read status, logout), so this never
// fetches a message or has any side effect, whether or not the real mailbox
// has synced before.
export async function testImapConnectionAction(
  input: TestImapConnectionInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const supabase = await createClient();

  const host = input.imapHost.trim();
  const username = input.imapUsername.trim();
  if (!host || !username) {
    return { ok: false, error: "Enter the IMAP host and username to test the connection." };
  }

  let encryptedPassword: string;
  if (input.imapPassword) {
    encryptedPassword = encryptSmtpPassword(input.imapPassword);
  } else if (input.mailboxId) {
    const existing = await getMailboxImapCredential(supabase, user.id, input.mailboxId);
    if (!existing?.encrypted_imap_password) {
      return { ok: false, error: "Enter the IMAP password to test the connection." };
    }
    encryptedPassword = existing.encrypted_imap_password;
  } else {
    return { ok: false, error: "Enter the IMAP password to test the connection." };
  }

  // Every field ImapReplyChecker never reads gets a neutral placeholder —
  // see the comment above. Not a real row, never persisted.
  const testMailbox: Tables<"mailboxes"> = {
    id: "00000000-0000-0000-0000-000000000000",
    user_id: user.id,
    domain_id: null,
    email: "",
    display_name: null,
    smtp_host: "",
    smtp_port: 587,
    smtp_username: "",
    encrypted_smtp_password: "",
    daily_limit: 1,
    warmup_enabled: false,
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reply_provider: "imap",
    imap_enabled: true,
    imap_host: host,
    imap_port: input.imapPort,
    imap_username: username,
    encrypted_imap_password: encryptedPassword,
    imap_uid_validity: null,
    imap_last_uid: null,
  };

  try {
    await Promise.race([
      new ImapReplyChecker(testMailbox).fetchNewMessages(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timed out after 10 seconds.")), TEST_CONNECTION_TIMEOUT_MS),
      ),
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't connect to the IMAP server." };
  }
}
