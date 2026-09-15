// Pairs with lib/db/resilient-read.ts's optionalRead: when an optional fetch
// exhausted its retries, the page keeps rendering with fallback data instead
// of crashing — but rendering the real widget as if that fallback were
// legitimately empty would hide a genuine failure (see CLAUDE.md's "no
// silent error swallowing"). Rendering this instead, inside the same
// WidgetErrorBoundary that already wraps the widget, throws during that
// boundary's own render pass so it shows its real "couldn't load" fallback
// (with the actual error message) rather than a fabricated empty state.
export function ThrowIfFailed({ error }: { error: unknown }): null {
  throw error instanceof Error ? error : new Error(typeof error === "string" ? error : "This section couldn't load.");
}
