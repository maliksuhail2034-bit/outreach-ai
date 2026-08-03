"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { connectAiProviderKeySchema, type ConnectAiProviderKeyInput } from "@/lib/validations/ai";
import { connectAiProviderKeyAction } from "@/app/(app)/settings/ai/actions";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PROVIDER_OPTIONS: { value: ConnectAiProviderKeyInput["provider"]; label: string }[] = [
  { value: "anthropic", label: "Claude (Anthropic)" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Gemini (Google)" },
];

export function AiProviderKeyForm({ onSuccess }: { onSuccess: () => void }) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<ConnectAiProviderKeyInput>({
    resolver: zodResolver(connectAiProviderKeySchema),
    defaultValues: { provider: "anthropic", apiKey: "", model: undefined },
  });

  function onSubmit(values: ConnectAiProviderKeyInput) {
    startTransition(async () => {
      try {
        await connectAiProviderKeyAction(values);
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
                <Input type="password" autoComplete="off" placeholder="sk-..." {...field} />
              </FormControl>
              <FormDescription>
                Stored encrypted. Never shown again in full — only the last 4 characters are displayed.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="model"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Model (optional)</FormLabel>
              <FormControl>
                <Input placeholder="Leave blank to use the provider default" {...field} value={field.value ?? ""} />
              </FormControl>
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
