import Link from "next/link";

import { PolimatiqLogo } from "@/components/shell/polimatiq-logo";
import { LEGAL_PAGES } from "@/components/legal/legal-pages";
import { Container } from "./container";
import { PRODUCT_NAME } from "./product-name";

const LINK_CLASS = "text-muted-foreground transition-colors hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <Container className="flex flex-col gap-8 py-12 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xs">
          <Link href="/" className="flex items-center">
            <PolimatiqLogo width={120} />
          </Link>
          <p className="mt-3 text-sm text-muted-foreground">
            One workspace for the entire cold email outreach workflow.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3 sm:gap-10">
          <nav aria-label="Product" className="flex flex-col gap-2">
            <span className="font-medium text-foreground">Product</span>
            <Link href="/#features" className={LINK_CLASS}>
              Features
            </Link>
            <Link href="/#how-it-works" className={LINK_CLASS}>
              How it works
            </Link>
            <Link href="/#pricing" className={LINK_CLASS}>
              Pricing
            </Link>
          </nav>
          <nav aria-label="Account" className="flex flex-col gap-2">
            <span className="font-medium text-foreground">Account</span>
            <Link href="/login" className={LINK_CLASS}>
              Log in
            </Link>
            <Link href="/signup" className={LINK_CLASS}>
              Get started
            </Link>
          </nav>
          <nav aria-label="Legal and support" className="col-span-2 flex flex-col gap-2 sm:col-span-1">
            <span className="font-medium text-foreground">Legal &amp; support</span>
            {LEGAL_PAGES.map((page) => (
              <Link key={page.href} href={page.href} className={LINK_CLASS}>
                {page.label}
              </Link>
            ))}
          </nav>
        </div>
      </Container>

      <Container className="border-t border-border py-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} {PRODUCT_NAME}. All rights reserved.
      </Container>
    </footer>
  );
}
