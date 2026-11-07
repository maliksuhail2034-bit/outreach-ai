import type { ReactNode } from "react";

import { requireStaffPage } from "@/lib/staff/auth";
import { SecurityTabs } from "@/components/console/security-tabs";
import { PageHeader } from "@/components/console/page-header";

export default async function SecurityLayout({ children }: { children: ReactNode }) {
  await requireStaffPage("security:view");

  return (
    <div className="space-y-6">
      <PageHeader title="Security center" description={<>Sign-ins, accounts, blocked addresses, the staff audit trail and compliance status. Every action here is recorded in the audit log.</>} />
      <SecurityTabs />
      {children}
    </div>
  );
}
