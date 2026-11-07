import type { ReactNode } from "react";

import { requireStaffPage } from "@/lib/staff/auth";
import { SecurityTabs } from "@/components/console/security-tabs";

export default async function SecurityLayout({ children }: { children: ReactNode }) {
  await requireStaffPage("security:view");

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security center</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign-ins, accounts, blocked addresses, the staff audit trail and compliance status. Every action here is recorded in the audit log.
        </p>
      </div>
      <SecurityTabs />
      {children}
    </div>
  );
}
