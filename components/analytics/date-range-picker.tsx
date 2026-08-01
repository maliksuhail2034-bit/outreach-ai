import Link from "next/link";

import type { DateRange, DateRangePreset } from "@/lib/analytics/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The quick-select range badges + custom-range form every per-entity
// analytics page (Campaign, Mailbox, Domain) offers — extracted so a page
// needing this control doesn't hand-copy the same markup a third time. A
// plain GET form/links, no client state: the date range lives entirely in
// the URL, same as every other analytics page already does.
export function DateRangePicker({
  basePath,
  preset,
  currentRange,
  options,
}: {
  basePath: string;
  preset: DateRangePreset;
  currentRange: DateRange;
  options: { preset: Exclude<DateRangePreset, "custom">; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1.5">
        {options.map((option) => (
          <Link key={option.preset} href={`${basePath}?range=${option.preset}`}>
            <Badge variant={preset === option.preset ? "default" : "outline"} className="cursor-pointer">
              {option.label}
            </Badge>
          </Link>
        ))}
      </div>
      <form className="flex items-end gap-2" action={basePath} method="get">
        <input type="hidden" name="range" value="custom" />
        <div className="space-y-1">
          <Label htmlFor="start" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="start"
            name="start"
            type="date"
            defaultValue={preset === "custom" ? currentRange.start : undefined}
            className="h-8 w-36"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="end" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="end"
            name="end"
            type="date"
            defaultValue={preset === "custom" ? currentRange.end : undefined}
            className="h-8 w-36"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>
    </div>
  );
}
