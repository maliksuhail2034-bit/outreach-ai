import type { ReactNode } from "react";

import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/footer";
import { Container } from "@/components/marketing/container";

// Public legal and support pages. Unlike app/page.tsx, this never
// redirects a signed-in user: customers need to reach these from inside
// the product too.
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Container>{children}</Container>
      </main>
      <SiteFooter />
    </div>
  );
}
