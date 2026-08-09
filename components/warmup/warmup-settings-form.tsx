"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { warmupSettingsSchema, type WarmupSettingsInput } from "@/lib/validations/warmup";
import { enableWarmupAction, updateWarmupSettingsAction } from "@/app/(app)/warmup/actions";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export function WarmupSettingsForm({
  mailboxId,
  mode,
  defaultValues,
  onSuccess,
}: {
  mailboxId: string;
  mode: "enable" | "settings";
  defaultValues: WarmupSettingsInput;
  onSuccess: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<WarmupSettingsInput>({
    resolver: zodResolver(warmupSettingsSchema),
    defaultValues,
  });

  function onSubmit(values: WarmupSettingsInput) {
    startTransition(async () => {
      try {
        if (mode === "enable") {
          await enableWarmupAction(mailboxId, values);
          toast.success("Warmup enabled.");
        } else {
          await updateWarmupSettingsAction(mailboxId, values);
          toast.success("Warmup settings updated.");
        }
        onSuccess();
      } catch {
        toast.error("Couldn't save warmup settings. Try again.");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          These settings drive this dashboard&apos;s ramp forecast only — they don&apos;t yet change what a live
          campaign actually sends. For real protection on a new mailbox, set its Daily/Hourly limit directly under
          Mailboxes.
        </p>
        <FormField
          control={form.control}
          name="targetDailyVolume"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Target daily volume</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                />
              </FormControl>
              <FormDescription>Emails per day this mailbox should ramp up to.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="rampUpPercent"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ramp-up speed (% per increase)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                />
              </FormControl>
              <FormDescription>How much daily volume grows at each scheduled increase.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : mode === "enable" ? "Enable warmup" : "Save settings"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
