"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { domainSchema, type DomainInput } from "@/lib/validations/deliverability";
import { createDomainAction } from "@/app/(app)/settings/deliverability/actions";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export function DomainForm({ onSuccess }: { onSuccess: () => void }) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<DomainInput>({
    resolver: zodResolver(domainSchema),
    defaultValues: { domain: "" },
  });

  function onSubmit(values: DomainInput) {
    startTransition(async () => {
      try {
        await createDomainAction(values);
        toast.success("Domain added.");
        onSuccess();
      } catch {
        toast.error("Couldn't add the domain. Try again.");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="domain"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Domain</FormLabel>
              <FormControl>
                <Input placeholder="yourdomain.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Adding…" : "Add domain"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
