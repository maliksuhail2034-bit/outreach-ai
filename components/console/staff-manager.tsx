"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { UserPlusIcon } from "lucide-react";

import type { StaffRole } from "@/lib/db/staff";
import { STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import {
  changeStaffRoleAction,
  createStaffAccountAction,
  resetStaffAccessAction,
  setStaffDisabledAction,
} from "@/app/console/(panel)/staff/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupLinkNotice } from "./setup-link-notice";

export interface StaffRow {
  id: string;
  displayName: string;
  email: string;
  role: StaffRole;
  status: "invited" | "active" | "disabled";
  lastSeenAt: string | null;
  isSelf: boolean;
}

const STATUS_VARIANT = { active: "default", invited: "secondary", disabled: "outline" } as const;

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function StaffManager({ rows, manageableRoles }: { rows: StaffRow[]; manageableRoles: StaffRole[] }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ url: string; name: string } | null>(null);
  const [form, setForm] = useState({ email: "", displayName: "", role: manageableRoles.includes("sales") ? "sales" : manageableRoles[0] });

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createStaffAccountAction({ email: form.email, displayName: form.displayName, role: form.role as StaffRole });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLink({ url: result.data.setupLink, name: form.displayName });
      setForm((current) => ({ ...current, email: "", displayName: "" }));
      toast.success("Staff account created.");
    });
  }

  function run(work: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) toast.error(result.error);
      else toast.success(success);
    });
  }

  function resetAccess(row: StaffRow) {
    if (!window.confirm(`Reset ${row.displayName}'s access? Their password and 2-step login stop working until they use the new setup link.`)) return;
    startTransition(async () => {
      const result = await resetStaffAccessAction(row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLink({ url: result.data.setupLink, name: row.displayName });
    });
  }

  return (
    <div className="space-y-6">
      {link && <SetupLinkNotice link={link.url} name={link.name} onDismiss={() => setLink(null)} />}

      {manageableRoles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Create a staff account</CardTitle>
            <CardDescription>
              Staff accounts are separate from customer accounts and can only be created here. Use the person&apos;s own
              work email; you&apos;ll get a one-time setup link to give them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="grid gap-4 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="staff-name">Name</Label>
                <Input id="staff-name" required maxLength={120} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-email">Work email</Label>
                <Input id="staff-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-role">Role</Label>
                <select
                  id="staff-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {manageableRoles.map((role) => (
                    <option key={role} value={role}>
                      {STAFF_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={pending}>
                <UserPlusIcon aria-hidden="true" />
                Create
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>Everyone with access to this console. Every change here is recorded in the audit log.</CardDescription>
        </CardHeader>
        <CardContent className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">Person</th>
                <th scope="col" className="py-2 pr-4 font-medium">Role</th>
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 pr-4 font-medium">Last seen</th>
                <th scope="col" className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const canManage = !row.isSelf && manageableRoles.includes(row.role);
                return (
                  <tr key={row.id}>
                    <td className="py-3 pr-4">
                      <p className="font-medium">
                        {row.displayName} {row.isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    </td>
                    <td className="py-3 pr-4">
                      {canManage && manageableRoles.length > 1 ? (
                        <select
                          aria-label={`Role for ${row.displayName}`}
                          value={row.role}
                          disabled={pending}
                          onChange={(e) => run(() => changeStaffRoleAction(row.id, e.target.value as StaffRole), "Role updated.")}
                          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                        >
                          {manageableRoles.map((role) => (
                            <option key={role} value={role}>
                              {STAFF_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        STAFF_ROLE_LABELS[row.role]
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{row.lastSeenAt ? dateFormatter.format(new Date(row.lastSeenAt)) : "—"}</td>
                    <td className="py-3 text-right">
                      {canManage && (
                        <div className="flex justify-end gap-2">
                          {row.status !== "disabled" && (
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => resetAccess(row)}>
                              Reset access
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={row.status === "disabled" ? "outline" : "destructive"}
                            disabled={pending}
                            onClick={() => {
                              const disabling = row.status !== "disabled";
                              if (disabling && !window.confirm(`Disable ${row.displayName}? They're signed out everywhere immediately.`)) return;
                              run(() => setStaffDisabledAction(row.id, disabling), disabling ? "Account disabled." : "Account enabled — they'll need a new setup link if they lost access.");
                            }}
                          >
                            {row.status === "disabled" ? "Enable" : "Disable"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
