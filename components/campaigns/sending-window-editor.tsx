"use client";

import { useWatch, type Control } from "react-hook-form";

import type { CampaignInput } from "@/lib/validations/campaigns";
import { SENDING_WINDOW_DAYS, type SendingWindowDay } from "@/lib/validations/sending-window";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimezoneSelect } from "./timezone-select";

const DAY_LABELS: Record<SendingWindowDay, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

// Ordered for the "Current schedule" summary below — SENDING_WINDOW_DAYS is
// already in this order, but field.value (built up by toggling buttons) can
// end up in any order, so the summary re-sorts before joining.
const DAY_ORDER: Record<SendingWindowDay, number> = Object.fromEntries(
  SENDING_WINDOW_DAYS.map((day, index) => [day, index]),
) as Record<SendingWindowDay, number>;

function formatHour(hour: number) {
  return hour === 24 ? "Midnight" : `${String(hour).padStart(2, "0")}:00`;
}

const START_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const END_HOURS = Array.from({ length: 24 }, (_, hour) => hour + 1);

// Isolated, reusable editor for the sendingWindow slice of CampaignInput —
// validated entirely by the existing sendingWindowSchema (via the parent
// form's zodResolver), no validation logic duplicated here.
export function SendingWindowEditor({ control }: { control: Control<CampaignInput> }) {
  const days = useWatch({ control, name: "sendingWindow.days" });
  const startHour = useWatch({ control, name: "sendingWindow.startHour" });
  const endHour = useWatch({ control, name: "sendingWindow.endHour" });
  const timezone = useWatch({ control, name: "sendingWindow.timezone" });

  const orderedDayLabels = [...days].sort((a, b) => DAY_ORDER[a] - DAY_ORDER[b]).map((day) => DAY_LABELS[day]);

  return (
    <div className="space-y-4">
      {/* Current schedule — always visible so a change to any field below is
          immediately legible in plain language, in the timezone that
          actually matters (the one chosen here, not the browser's). */}
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">Current schedule: </span>
        {days.length === 0 ? (
          <span className="text-muted-foreground">No days selected yet.</span>
        ) : (
          <span className="text-muted-foreground">
            {orderedDayLabels.join(", ")}, {formatHour(startHour)}–{formatHour(endHour)} ({timezone || "no timezone set"})
          </span>
        )}
      </div>

      <FormField
        control={control}
        name="sendingWindow.days"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Allowed days</FormLabel>
            <FormControl>
              <div className="flex flex-wrap gap-2">
                {SENDING_WINDOW_DAYS.map((day) => {
                  const selected = field.value.includes(day);
                  return (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      aria-pressed={selected}
                      onClick={() =>
                        field.onChange(
                          selected
                            ? field.value.filter((d: SendingWindowDay) => d !== day)
                            : [...field.value, day],
                        )
                      }
                    >
                      {DAY_LABELS[day]}
                    </Button>
                  );
                })}
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="sendingWindow.startHour"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Start hour</FormLabel>
              <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {START_HOURS.map((hour) => (
                    <SelectItem key={hour} value={String(hour)}>
                      {formatHour(hour)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="sendingWindow.endHour"
          render={({ field }) => (
            <FormItem>
              <FormLabel>End hour</FormLabel>
              <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {END_HOURS.map((hour) => (
                    <SelectItem key={hour} value={String(hour)}>
                      {formatHour(hour)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="sendingWindow.timezone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Timezone</FormLabel>
            <FormControl>
              <TimezoneSelect value={field.value} onChange={field.onChange} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
