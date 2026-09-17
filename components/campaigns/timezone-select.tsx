"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { getAllIanaTimezones } from "@/lib/timezones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function currentOffsetLabel(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" }).formatToParts(
      new Date(),
    );
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function displayName(timezone: string): string {
  return timezone.replace(/_/g, " ");
}

// Searchable IANA timezone picker for a campaign's sending window — the full
// list (lib/timezones.ts's getAllIanaTimezones, ~400+ real zones), not a
// hand-maintained handful. Stores the canonical IANA identifier (e.g.
// "Asia/Riyadh"); the current UTC offset shown alongside each option is
// display-only, computed fresh rather than hardcoded so it's never wrong
// after a DST transition.
export function TimezoneSelect({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string;
  onChange: (timezone: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const allTimezones = useMemo(() => getAllIanaTimezones(), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTimezones;
    return allTimezones.filter((tz) => displayName(tz).toLowerCase().includes(q));
  }, [allTimezones, query]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleOpen() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSelect(timezone: string) {
    onChange(timezone);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        id={id}
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className="w-full justify-between font-normal"
        onClick={() => (open ? setOpen(false) : handleOpen())}
      >
        <span className="truncate">
          {value ? `${displayName(value)} (${currentOffsetLabel(value)})` : "Select a timezone"}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-64 rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b border-border p-1.5">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search timezones…"
              aria-label="Search timezones"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <ul className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">No matching timezone.</li>
            ) : (
              filtered.map((tz) => (
                <li key={tz}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      tz === value && "bg-accent/50",
                    )}
                    onClick={() => handleSelect(tz)}
                  >
                    <span className="truncate">{displayName(tz)}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {currentOffsetLabel(tz)}
                      {tz === value && <CheckIcon className="size-3.5" />}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
