// Route-level loading for app/(app)/**/loading.tsx: a plain circular spinner,
// centred in the content area beside the sidebar and below the top nav. The
// height is that area exactly — the viewport minus TopNav's h-16 and <main>'s
// own vertical padding at each breakpoint (app/(app)/layout.tsx) — so the
// spinner sits at its true centre. No visible text; the status is announced
// to assistive tech once. With motion reduced the ring stays static.
export function RouteLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className="grid min-h-[calc(100svh-4rem-2rem)] place-items-center sm:min-h-[calc(100svh-4rem-3rem)] lg:min-h-[calc(100svh-4rem-4rem)]"
    >
      <span
        aria-hidden="true"
        className="block size-8 animate-spin rounded-full border-[3px] border-muted-foreground/25 border-t-primary motion-reduce:animate-none"
      />
    </div>
  );
}
