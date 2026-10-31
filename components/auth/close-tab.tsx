"use client";

import { useEffect } from "react";

// Browsers only let a script close a tab that a script opened, so this
// succeeds in some mail clients and is silently ignored in others — the page
// asks the user to close it as a fallback.
export function CloseTab() {
  useEffect(() => {
    const timeout = window.setTimeout(() => window.close(), 1500);
    return () => window.clearTimeout(timeout);
  }, []);

  return null;
}
