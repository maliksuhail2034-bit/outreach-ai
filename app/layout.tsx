import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { MotionProvider } from "@/components/motion/motion-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// metadataBase derives from the same env var the app already uses to build
// absolute links (Stripe redirects, OAuth callbacks, unsubscribe links — see
// lib/email/unsubscribe-token.ts). Keeping it here means the domain migration
// to polimatiq.com needs one env var change, not a code change.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const SITE_TITLE = "Polimatiq | Cold Email Outreach Software";
const SITE_DESCRIPTION =
  "Polimatiq is a cold email outreach platform for managing mailboxes, leads, campaigns, sequences, replies, warmup, and analytics in one workspace.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "Polimatiq",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <MotionProvider reducedMotion="user">
            {children}
            <Toaster position="top-right" />
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
