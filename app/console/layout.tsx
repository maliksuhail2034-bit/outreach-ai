import type { Metadata } from "next";
import type { ReactNode } from "react";

// The staff console is never indexed and never cached by intermediaries.
export const metadata: Metadata = {
  title: "Staff console · Polimatiq",
  robots: { index: false, follow: false, nocache: true },
};

export default function ConsoleRootLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-svh bg-background">{children}</div>;
}
