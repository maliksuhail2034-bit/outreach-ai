import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { BUSINESS_DETAILS, PLACEHOLDER_LABELS, type BusinessDetails } from "./business-details";
import { LEGAL_PAGES, type LegalPageHref } from "./legal-pages";

// A business detail that hasn't been confirmed yet. Rendered as visible,
// unmistakable placeholder text so an unfinished page can't pass as final.
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded-sm bg-amber-500/15 px-1 font-medium text-amber-700 dark:text-amber-300">
      [To be confirmed: {children}]
    </mark>
  );
}

// One value from BUSINESS_DETAILS, or its placeholder while it's unset.
export function BusinessDetail({ field }: { field: keyof BusinessDetails }) {
  const value = BUSINESS_DETAILS[field];
  if (value === null) return <Placeholder>{PLACEHOLDER_LABELS[field]}</Placeholder>;
  return <>{value}</>;
}

// The support address as a mailto link, or its placeholder while unset.
export function SupportEmail({ subject }: { subject?: string }) {
  const email = BUSINESS_DETAILS.supportEmail;
  if (email === null) return <Placeholder>{PLACEHOLDER_LABELS.supportEmail}</Placeholder>;
  const href = subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
  return (
    <a href={href} className="font-medium text-foreground underline underline-offset-4">
      {email}
    </a>
  );
}

export interface LegalSection {
  id: string;
  title: string;
  content: ReactNode;
}

// Shared shape for every legal page: title, effective date, a short
// summary, an on-page contents list, the numbered sections, and links to
// the other legal pages. No typography plugin: the prose styles below are
// scoped to this component's own article.
export function LegalDocument({
  href,
  title,
  summary,
  sections,
}: {
  href: LegalPageHref;
  title: string;
  summary: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <div className="grid gap-10 py-10 sm:py-14 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14">
      <nav aria-label="Legal" className="lg:sticky lg:top-24 lg:self-start">
        <p className="text-sm font-medium text-foreground">Legal</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm lg:flex-col lg:gap-2">
          {LEGAL_PAGES.map((page) => (
            <li key={page.href}>
              <Link
                href={page.href}
                aria-current={page.href === href ? "page" : undefined}
                className={cn(
                  "transition-colors hover:text-foreground",
                  page.href === href ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 max-w-3xl">
        <header className="border-b border-border pb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: <BusinessDetail field="lastUpdated" />
          </p>
          <div className="mt-4 text-base leading-relaxed text-muted-foreground">{summary}</div>
        </header>

        {sections.length > 1 && (
          <nav aria-label="On this page" className="border-b border-border py-6">
            <p className="text-sm font-medium text-foreground">On this page</p>
            <ol className="mt-3 list-decimal pl-5 text-sm text-muted-foreground sm:columns-2 sm:gap-x-10">
              {sections.map((section) => (
                <li key={section.id} className="mb-1.5 break-inside-avoid">
                  <a href={`#${section.id}`} className="transition-colors hover:text-foreground">
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div
          className={cn(
            "text-[0.9375rem] leading-relaxed text-muted-foreground",
            "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5",
            "[&_strong]:font-medium [&_strong]:text-foreground",
            "[&_a:not([class])]:font-medium [&_a:not([class])]:text-foreground [&_a:not([class])]:underline [&_a:not([class])]:underline-offset-4",
          )}
        >
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24 pt-8">
              <h2 id={`${section.id}-heading`} className="text-xl font-semibold tracking-tight text-foreground">
                {sections.length > 1 ? `${index + 1}. ` : ""}
                {section.title}
              </h2>
              {section.content}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
