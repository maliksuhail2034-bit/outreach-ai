"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import type { MailboxSafe } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { CAMPAIGN_STATUSES, campaignSchema, type CampaignInput } from "@/lib/validations/campaigns";
import { createCampaignAction, updateCampaignAction } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_MAILBOX = "none";

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

type CampaignFormProps =
  | { mode: "create"; campaign?: undefined; mailboxes: MailboxSafe[]; onSuccess?: () => void }
  | { mode: "edit"; campaign: Tables<"campaigns">; mailboxes: MailboxSafe[]; onSuccess?: () => void };

export function CampaignForm({ mode, campaign, mailboxes, onSuccess }: CampaignFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<CampaignInput>({
    resolver: zodResolver(campaignSchema),
    defaultValues:
      mode === "edit"
        ? {
            name: campaign.name,
            status: campaign.status as CampaignInput["status"],
            dailyLimit: campaign.daily_limit,
            defaultMailboxId: campaign.default_mailbox_id ?? "",
          }
        : {
            name: "",
            dailyLimit: 50,
            defaultMailboxId: "",
          },
  });

  function onSubmit(values: CampaignInput) {
    startTransition(async () => {
      try {
        if (mode === "create") {
          await createCampaignAction(values);
          toast.success("Campaign created.");
        } else {
          await updateCampaignAction(campaign.id, values);
          toast.success("Campaign updated.");
        }
        onSuccess?.();
      } catch {
        toast.error(
          mode === "create" ? "Couldn't create the campaign. Try again." : "Couldn't update the campaign. Try again.",
        );
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Q3 outbound push" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="dailyLimit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Daily send limit</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="defaultMailboxId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default mailbox</FormLabel>
                <Select
                  value={field.value || NO_MAILBOX}
                  onValueChange={(value) => field.onChange(value === NO_MAILBOX ? "" : value)}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="No default mailbox" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NO_MAILBOX}>No default mailbox</SelectItem>
                    {mailboxes.map((mailbox) => (
                      <SelectItem key={mailbox.id} value={mailbox.id}>
                        {mailbox.display_name || mailbox.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {mode === "edit" && (
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CAMPAIGN_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {statusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Create campaign" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
