"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { connectVerificationProviderKeySchema, type ConnectVerificationProviderKeyInput } from "@/lib/validations/verification";
import { connectVerificationProviderKeyAction } from "@/app/(app)/settings/verification/actions";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PROVIDER_OPTIONS: { value: ConnectVerificationProviderKeyInput["provider"]; label: string }[] = [
  { value: "millionverifier", label: "MillionVerifier" },
];

export function VerificationProviderKeyForm({ onSuccess }: { onSuccess: () => void }) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<ConnectVerificationProviderKeyInput>({
    resolver: zodResolver(connectVerificationProviderKeySchema),
    defaultValues: { provider: "millionverifier", apiKey: "" },
  });

  function onSubmit(values: ConnectVerificationProviderKeyInput) {
    startTransition(async () => {
      try {
        await connectVerificationProviderKeyAction(values);
        toast.success("API key connected.");
        onSuccess();
      } catch {
        toast.error("Couldn't connect the API key. Check it and try again.");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Provider</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="apiKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>API key</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="off" placeholder="Paste your MillionVerifier API key" {...field} />
              </FormControl>
              <FormDescription>
                Stored encrypted. Never shown again in full — only the last 4 characters are displayed.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Connecting…" : "Connect key"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
