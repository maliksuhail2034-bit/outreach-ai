import Link from "next/link";

import { Container } from "./container";
import { PRODUCT_NAME } from "./product-name";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <Container className="flex flex-col gap-8 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">
              P
            </span>
            {PRODUCT_NAME}
          </Link>
          <p className="mt-3 text-sm text-muted-foreground">
            One workspace for the entire cold email outreach workflow.
          </p>
        </div>

        <div className="flex gap-10 text-sm">
          <div className="flex flex-col gap-2">
            <span className="font-medium text-foreground">Product</span>
            <a href="#features" className="text-muted-foreground transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#how-it-works" className="text-muted-foreground transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#pricing" className="text-muted-foreground transition-colors hover:text-foreground">
              Pricing
            </a>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-medium text-foreground">Account</span>
            <Link href="/login" className="text-muted-foreground transition-colors hover:text-foreground">
              Log in
            </Link>
            <Link href="/signup" className="text-muted-foreground transition-colors hover:text-foreground">
              Get started
            </Link>
          </div>
        </div>
      </Container>

      <Container className="border-t border-border py-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} {PRODUCT_NAME}. All rights reserved.
      </Container>
    </footer>
  );
}
