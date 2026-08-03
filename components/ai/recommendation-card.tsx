"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SparklesIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import type { AiProviderName } from "@/lib/ai/get-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AiRecommendation = Tables<"ai_recommendations">;

const PROVIDER_LABEL: Record<AiProviderName, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  google: "Gemini",
};

interface RecommendationCardProps {
  // Which providers this organization has connected a BYOK key for — see
  // /settings/ai. Empty means no key at all, not "still loading."
  connectedProviders: AiProviderName[];
  initialRecommendation: AiRecommendation | null;
  // A Server Function reference, already bound to this entity's id (see
  // e.g. app/(app)/campaigns/[campaignId]/analytics/actions.ts) — this
  // component never knows which entity type it's rendering for.
  generateAction: (provider: AiProviderName) => Promise<AiRecommendation>;
}

// Shared by every analytics page (campaign, mailbox, domain, organization)
// so "Generate Recommendation" renders identically everywhere instead of a
// per-page copy. Only ever calls generateAction on an explicit click — no
// auto-generation, no polling, matching ROADMAP.md's "AI Recommendations v1
// is manual-only" scope. Recommendation text is rendered as plain text
// (never dangerouslySetInnerHTML) since it's untrusted model output.
export function RecommendationCard({ connectedProviders, initialRecommendation, generateAction }: RecommendationCardProps) {
  const [recommendation, setRecommendation] = useState(initialRecommendation);
  const [provider, setProvider] = useState<AiProviderName | undefined>(connectedProviders[0]);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    if (!provider) return;
    startTransition(async () => {
      try {
        const result = await generateAction(provider);
        setRecommendation(result);
        if (result.status === "failed") {
          toast.error(result.error_message ?? "Generation failed. Try again.");
        } else {
          toast.success("Recommendation generated.");
        }
      } catch {
        toast.error("Couldn't generate a recommendation. Try again.");
      }
    });
  }

  if (connectedProviders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Recommendation</CardTitle>
          <CardDescription>
            Bring your own Claude, OpenAI, or Gemini API key to generate a recommendation from this page&apos;s data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/ai">Connect an API key</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-4">
        <div>
          <CardTitle>AI Recommendation</CardTitle>
          <CardDescription>Generated only when you click below — never on a schedule.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {connectedProviders.length > 1 && (
            <Select value={provider} onValueChange={(value) => setProvider(value as AiProviderName)}>
              <SelectTrigger className="w-32" aria-label="AI provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connectedProviders.map((option) => (
                  <SelectItem key={option} value={option}>
                    {PROVIDER_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={handleGenerate} disabled={isPending}>
            <SparklesIcon />
            {isPending ? "Generating…" : recommendation ? "Regenerate" : "Generate Recommendation"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!recommendation ? (
          <p className="text-sm text-muted-foreground">No recommendation generated yet.</p>
        ) : recommendation.status === "failed" ? (
          <p className="text-sm text-destructive">{recommendation.error_message ?? "Generation failed."}</p>
        ) : (
          <div className="space-y-2">
            <p className="whitespace-pre-line text-sm">{recommendation.recommendation_text}</p>
            <p className="text-xs text-muted-foreground">
              Generated {new Date(recommendation.created_at).toLocaleString()} ·{" "}
              {PROVIDER_LABEL[recommendation.provider as AiProviderName] ?? recommendation.provider}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
