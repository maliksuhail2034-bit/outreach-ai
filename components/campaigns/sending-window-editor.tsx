"use client";

import type { Control } from "react-hook-form";

import type { CampaignInput } from "@/lib/validations/campaigns";
import { SENDING_WINDOW_DAYS, type SendingWindowDay } from "@/lib/validations/sending-window";
import { TIMEZONES } from "@/lib/timezones";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DAY_LABELS: Record<SendingWindowDay, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function formatHour(hour: number) {
  return hour === 24 ? "Midnight" : `${String(hour).padStart(2, "0")}:00`;
}

const START_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const END_HOURS = Array.from({ length: 24 }, (_, hour) => hour + 1);

// Isolated, reusable editor for the sendingWindow slice of CampaignInput —
// validated entirely by the existing sendingWindowSchema (via the parent
// form's zodResolver), no validation logic duplicated here.
export function SendingWindowEditor({ control }: { control: Control<CampaignInput> }) {
  return (
    <div className="space-y-4">
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
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a timezone" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
