// Creates the first Polimatiq OWNER staff account and prints its one-time
// setup link. Everything after the first owner is done in the staff console
// (/console/staff). Run on the server with the environment loaded, e.g.:
//
//   systemd-run --working-directory=/srv/polimatiq/current \
//     --property=EnvironmentFile=/etc/polimatiq/prod.env --wait --pipe --collect \
//     /usr/bin/node --no-warnings scripts/create-owner.mts --email owner@company.com --name "Full Name" --username owner.name
//
// Refuses when an active owner already exists, unless --additional is given
// (a second owner created by an existing one should use the console).
// The setup link is printed once to this terminal; it is not stored. It
// signs the person in to set a password, then the console requires 2-step
// login setup. It expires per the project's email OTP expiry (1 h default).
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    username: { type: "string" },
    additional: { type: "boolean", default: false },
  },
  strict: true,
});

process.exitCode = await main();

async function main(): Promise<number> {
  const projectUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!projectUrl || !serviceKey || !appUrl) {
    return refuse("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_APP_URL must be set (load the env file with systemd).");
  }
  const email = (values.email ?? "").trim().toLowerCase();
  const name = (values.name ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return refuse("--email must be a valid address.");
  if (name.length < 1 || name.length > 120) return refuse("--name is required (1-120 characters).");
  // Same rule as lib/staff/password-policy.ts (this script stays self-contained).
  const username = (values.username ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    return refuse("--username is required: 3-32 characters, letters, numbers, dots, dashes or underscores (not an email).");
  }

  const supabase = createClient<Database>(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { count, error: countError } = await supabase
    .from("staff_members")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("status", "active");
  if (countError) return refuse(`Couldn't read staff_members: ${countError.message}`);
  if ((count ?? 0) > 0 && !values.additional) {
    return refuse("An active owner already exists. Create further owners in the staff console, or pass --additional on purpose.");
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { polimatiq_staff: true },
    user_metadata: { full_name: name },
  });
  if (createError || !created.user) {
    return refuse(
      createError && /already|registered|exists/i.test(createError.message)
        ? "That email already has a Polimatiq account. The owner's staff login must use its own, separate address."
        : `Couldn't create the auth user: ${createError?.message ?? "unknown error"}`,
    );
  }

  const { data: staff, error: insertError } = await supabase
    .from("staff_members")
    .insert({ user_id: created.user.id, role: "owner", display_name: name, username, status: "invited", password_must_change: true })
    .select("id")
    .single();
  if (insertError || !staff) {
    await supabase.auth.admin.deleteUser(created.user.id);
    return refuse(`Couldn't create the staff record (rolled back the auth user): ${insertError?.message ?? "unknown error"}`);
  }

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: "recovery", email });
  if (linkError || !link.properties?.hashed_token) {
    return refuse(
      `The account was created but the setup link failed (${linkError?.message ?? "no token returned"}). ` +
        "Delete this user in Supabase Auth and run the script again.",
    );
  }

  await supabase.from("staff_audit_log").insert({
    actor_user_id: null,
    actor_role: "system",
    action: "staff.owner_bootstrapped",
    target_type: "staff_member",
    target_id: staff.id,
    metadata: { via: "scripts/create-owner.mts", additional: values.additional ?? false },
  });

  const url = new URL("/auth/confirm", new URL(appUrl).origin);
  url.searchParams.set("token_hash", link.properties.hashed_token);
  url.searchParams.set("type", "recovery");
  url.searchParams.set("next", "/console/account?required=password");

  console.log(`Owner staff account created for ${email} (username: ${username}). Sign in later at /console/login.`);
  console.log("One-time setup link (hand it over privately; it is not stored):");
  console.log(url.toString());
  return 0;
}

function refuse(message: string): number {
  console.error(`create-owner: ${message}`);
  return 1;
}
