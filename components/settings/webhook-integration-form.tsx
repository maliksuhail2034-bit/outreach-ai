"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { webhookIntegrationSchema, type WebhookIntegrationInput } from "@/lib/validations/integrations";
import { connectWebhookIntegrationAction } from "@/app/(app)/settings/integrations/actions";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export function WebhookIntegrationForm({ onSuccess }: { onSuccess: () => void }) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<WebhookIntegrationInput>({
    resolver: zodResolver(webhookIntegrationSchema),
    defaultValues: { url: "" },
  });

  function onSubmit(values: WebhookIntegrationInput) {
    startTransition(async () => {
      try {
        await connectWebhookIntegrationAction(values);
        toast.success("Webhook connected.");
        onSuccess();
      } catch {
        toast.error("Couldn't connect the webhook. Try again.");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Webhook URL</FormLabel>
              <FormControl>
                <Input placeholder="https://example.com/hooks/outreach-ai" {...field} />
              </FormControl>
              <FormDescription>
                Receives an organization digest (overview metrics and AI Insights) as a JSON POST on a schedule.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Connecting…" : "Connect webhook"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
