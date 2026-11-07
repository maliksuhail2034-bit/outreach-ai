"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRightIcon, UserPlusIcon } from "lucide-react";

import type { StaffRole } from "@/lib/db/staff";
import { STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import { usernameProblem } from "@/lib/staff/password-policy";
import { STAFF_STATUS_LABELS as STATUS_LABELS, STAFF_STATUS_VARIANT as STATUS_VARIANT } from "@/lib/staff/status";
import { createStaffAccountAction } from "@/app/console/(panel)/staff/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupLinkNotice } from "./setup-link-notice";

export interface StaffRow {
  id: string;
  displayName: string;
  username: string;
  email: string;
  role: StaffRole;
  status: "invited" | "active" | "disabled" | "archived";
  mfa: boolean;
  lastSeenAt: string | null;
  weekHours: string;
  isSelf: boolean;
}


const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function StaffManager({
  rows,
  manageableRoles,
  archivedCount,
  showArchived,
}: {
  rows: StaffRow[];
  manageableRoles: StaffRole[];
  archivedCount: number;
  showArchived: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ url: string; name: string } | null>(null);
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    username: "",
    role: manageableRoles.includes("sales") ? "sales" : manageableRoles[0],
  });
  const usernameError = form.username ? usernameProblem(form.username) : null;

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (usernameError) return;
    startTransition(async () => {
      const result = await createStaffAccountAction({
        email: form.email,
        displayName: form.displayName,
        username: form.username,
        role: form.role as StaffRole,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLink({ url: result.data.setupLink, name: form.displayName });
      setForm((current) => ({ ...current, email: "", displayName: "", username: "" }));
      toast.success("Employee account created.");
    });
  }

  return (
    <div className="space-y-6">
      {link && <SetupLinkNotice link={link.url} name={link.name} onDismiss={() => setLink(null)} />}

      {manageableRoles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add an employee</CardTitle>
            <CardDescription>
              Staff accounts are separate from customer accounts. They sign in with their username at /console/login; the
              email is only used for their account record. You&apos;ll get a one-time setup link to hand over privately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_150px_auto] lg:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="staff-name">Full name</Label>
                <Input id="staff-name" required maxLength={120} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-username">Username</Label>
                <Input
                  id="staff-username"
                  required
                  autoCapitalize="none"
                  spellCheck={false}
                  value={form.username}
                  aria-invalid={Boolean(usernameError)}
                  aria-describedby="staff-username-help"
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-email">Work email</Label>
                <Input id="staff-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-role">Role</Label>
                <select
                  id="staff-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {manageableRoles.map((role) => (
                    <option key={role} value={role}>
                      {STAFF_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={pending || Boolean(usernameError)}>
                <UserPlusIcon aria-hidden="true" />
                {pending ? "Creating…" : "Add"}
              </Button>
              <p id="staff-username-help" className={`text-xs sm:col-span-2 lg:col-span-5 ${usernameError ? "text-destructive" : "text-muted-foreground"}`}>
                {usernameError ?? "Username: 3-32 characters, letters, numbers, dots, dashes or underscores — not an email. It can be changed later."}
              </p>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Employees</CardTitle>
            {archivedCount > 0 && (
              <Link
                href={showArchived ? "/console/staff" : "/console/staff?archived=1"}
                className="rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
              </Link>
            )}
          </div>
          <CardDescription>
            Everyone with access to this console. Open someone to block them, set their password, change their username or
            role, see their hours and what they&apos;ve done.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">Person</th>
                <th scope="col" className="py-2 pr-4 font-medium">Role</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 pr-4 font-medium">2-step</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Hours (7 days)</th>
                <th scope="col" className="py-2 pr-4 font-medium">Last active</th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/40">
                  <td className="py-3 pr-4">
                    <Link href={`/console/staff/${row.id}`} className="rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                      {row.displayName}
                    </Link>
                    {row.isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{row.username}</span> · {row.email}
                    </p>
                  </td>
                  <td className="py-3 pr-4">{STAFF_ROLE_LABELS[row.role]}</td>
                  <td className="py-3 pr-4">
                    <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{row.mfa ? "On" : "Not set up"}</td>
                  <td className="py-3 pr-4 text-right tabular-nums">{row.weekHours}</td>
                  <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">{row.lastSeenAt ? dateFormatter.format(new Date(row.lastSeenAt)) : "—"}</td>
                  <td className="py-3 text-right">
                    <Link
                      href={`/console/staff/${row.id}`}
                      aria-label={`Open ${row.displayName}`}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <ChevronRightIcon className="size-4" aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
