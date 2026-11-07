"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Shows a freshly issued setup link exactly once. It isn't stored anywhere,
// so the operator copies it now and hands it over through a private channel.
export function SetupLinkNotice({ link, name, onDismiss }: { link: string; name: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div role="status" className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
      <p className="flex items-start gap-2 text-sm font-medium">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        Setup link for {name} — shown once
      </p>
      <p className="text-xs text-muted-foreground">
        Send it privately (not in a group chat or email thread). It works once, expires after the project&apos;s link
        lifetime (1 hour by default), and leads them to set a password and 2-step login. If it expires, use “Reset
        access” to issue a new one.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          aria-label="Setup link"
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
        I&apos;ve handed it over
      </Button>
    </div>
  );
}
