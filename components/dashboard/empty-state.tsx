import type { ReactNode } from "react";

// Reusable "nothing here yet" block — the pattern already duplicated ad
// hoc across several list components (mailboxes, domains, warmup). New
// dashboard sections should use this instead of re-inlining it; existing
// call sites are left as-is rather than retrofitted (out of scope for this
// task).
export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <div className="mx-auto flex size-10 items-center justify-center text-muted-foreground">{icon}</div>
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
