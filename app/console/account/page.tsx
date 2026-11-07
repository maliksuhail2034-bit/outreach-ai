import Link from "next/link";
import { ArrowLeftIcon, KeyRoundIcon } from "lucide-react";

import { requireStaffAccountAccess } from "@/lib/staff/auth";
import { needsPasswordChange, staffPasswordMinLength, type StaffRoleName } from "@/lib/staff/password-policy";
import { STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import { OwnPasswordForm, OwnUsernameForm } from "@/components/console/account-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { staffSignOutAction } from "@/app/console/session-actions";
import { Button } from "@/components/ui/button";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

// The signed-in staff member's own account: password (required here before
// anything else when it doesn't meet the staff policy, or an owner/security
// member set it) and username. Outside the (panel) layout on purpose — the
// panel's gate sends people here.
export default async function StaffAccountPage() {
  const session = await requireStaffAccountAccess();
  const role = session.role as StaffRoleName;
  const required = needsPasswordChange(session.staff);
  const firstTime = session.mfa === "needs_enrollment";
  const min = staffPasswordMinLength(role);

  return (
    <div className="flex min-h-svh items-start justify-center p-4 sm:items-center">
      <div className="w-full max-w-lg space-y-4">
        {!required && (
          <Link href="/console" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            Back to the console
          </Link>
        )}
        <Card>
          <CardHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <KeyRoundIcon className="size-5" aria-hidden="true" />
            </div>
            <CardTitle className="text-xl">{required ? (firstTime ? "Choose your password" : "Set a new password") : "Change password"}</CardTitle>
            <CardDescription>
              {required
                ? firstTime
                  ? `Welcome, ${session.staff.display_name}. ${STAFF_ROLE_LABELS[session.role]} accounts need a password of at least ${min} characters. Next you'll set up 2-step login.`
                  : session.staff.password_must_change
                    ? "Your password was set by an administrator. Choose your own before continuing."
                    : `${STAFF_ROLE_LABELS[session.role]} accounts now need a password of at least ${min} characters. Choose a new one to continue.`
                : `At least ${min} characters for ${STAFF_ROLE_LABELS[session.role].toLowerCase()} accounts. Use a password manager.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OwnPasswordForm role={role} submitLabel={required ? "Save and continue" : "Change password"} />
          </CardContent>
        </Card>

        {!required && session.mfa === "verified" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sign-in name</CardTitle>
              <CardDescription>
                Staff sign in at /console/login with a username, never their email.
                {session.staff.password_changed_at && ` Password last changed ${dateFormatter.format(new Date(session.staff.password_changed_at))} UTC.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OwnUsernameForm username={session.staff.username} />
            </CardContent>
          </Card>
        )}

        {required && (
          <form action={staffSignOutAction} className="text-center">
            <Button type="submit" variant="link" size="sm">
              Sign out
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
