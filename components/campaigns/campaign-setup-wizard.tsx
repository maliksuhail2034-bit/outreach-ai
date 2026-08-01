"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import type { MailboxSafe } from "@/lib/db";
import type { CampaignReadinessResult } from "@/lib/campaigns/readiness";
import type { SendingWindow } from "@/lib/validations/sending-window";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CampaignLeadTable } from "./campaign-lead-table";
import { SequenceStepsPanel } from "@/components/sequences/sequence-steps-panel";
import { MailboxAssignmentStep } from "./mailbox-assignment-step";
import { CampaignReviewStep } from "./campaign-review-step";

type Campaign = Tables<"campaigns">;
type CampaignLead = Tables<"campaign_leads">;
type Lead = Tables<"leads">;
type LeadList = Tables<"lead_lists">;
type SequenceStep = Tables<"sequence_steps">;

type WizardStepId = "leads" | "mailbox" | "sequence" | "review";

const STEPS: { id: WizardStepId; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "mailbox", label: "Mailbox" },
  { id: "sequence", label: "Sequence" },
  { id: "review", label: "Review & launch" },
];

// Derives readiness purely from already-loaded data (never stored wizard
// state), so leaving mid-setup and coming back just resumes correctly — see
// the Campaign Builder plan's "Proposed UI flow" section.
function deriveStep(campaign: Campaign, campaignLeads: CampaignLead[], sequenceSteps: SequenceStep[]): WizardStepId {
  if (campaignLeads.length === 0) return "leads";
  if (!campaign.default_mailbox_id) return "mailbox";
  if (sequenceSteps.length === 0) return "sequence";
  return "review";
}

export function CampaignSetupWizard({
  campaign,
  campaignLeads,
  leads,
  availableLeads,
  leadLists,
  mailboxes,
  sequenceId,
  sequenceSteps,
  templates,
  sendingWindow,
  suppressions,
  readiness,
}: {
  campaign: Campaign;
  campaignLeads: CampaignLead[];
  leads: Lead[];
  availableLeads: Lead[];
  leadLists: LeadList[];
  mailboxes: MailboxSafe[];
  sequenceId: string | null;
  sequenceSteps: SequenceStep[];
  templates: Tables<"templates">[];
  sendingWindow: SendingWindow;
  suppressions: Tables<"suppressions">[];
  readiness: CampaignReadinessResult;
}) {
  const derivedStep = deriveStep(campaign, campaignLeads, sequenceSteps);
  const [selected, setSelected] = useState<WizardStepId>(derivedStep);

  // Auto-advance only when the step the user was actually sitting on just
  // became complete (e.g. they enrolled a lead and campaignLeads flipped
  // from empty) — never yank them off a different, already-complete step
  // they navigated back to on purpose.
  const previousDerivedStep = useRef(derivedStep);
  useEffect(() => {
    if (derivedStep !== previousDerivedStep.current && selected === previousDerivedStep.current) {
      setSelected(derivedStep);
    }
    previousDerivedStep.current = derivedStep;
  }, [derivedStep, selected]);

  const completed: Record<WizardStepId, boolean> = {
    leads: campaignLeads.length > 0,
    mailbox: Boolean(campaign.default_mailbox_id),
    sequence: sequenceSteps.length > 0,
    review: false,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((step, index) => (
          <div key={step.id} className="flex items-center gap-2">
            {index > 0 && <span className="text-muted-foreground">→</span>}
            <Button
              type="button"
              variant={selected === step.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelected(step.id)}
            >
              {completed[step.id] && <CheckIcon className="size-3.5" />}
              {step.label}
            </Button>
          </div>
        ))}
        <Badge variant={readiness.ready ? "default" : "outline"} className={cn("ml-auto")}>
          {readiness.ready ? "Ready to launch" : "Draft — not sending yet"}
        </Badge>
      </div>

      {selected === "leads" && (
        <CampaignLeadTable
          campaignId={campaign.id}
          campaignLeads={campaignLeads}
          leads={leads}
          availableLeads={availableLeads}
          leadLists={leadLists}
          mailboxes={mailboxes}
          steps={sequenceSteps}
          suppressions={suppressions}
        />
      )}

      {selected === "mailbox" && (
        <MailboxAssignmentStep
          campaign={campaign}
          mailboxes={mailboxes}
          sendingWindow={sendingWindow}
          onAssigned={() => setSelected(derivedStep)}
        />
      )}

      {selected === "sequence" && (
        <SequenceStepsPanel
          campaignId={campaign.id}
          sequenceId={sequenceId}
          steps={sequenceSteps}
          templates={templates}
        />
      )}

      {selected === "review" && (
        <CampaignReviewStep
          campaign={campaign}
          campaignLeads={campaignLeads}
          mailboxes={mailboxes}
          sequenceSteps={sequenceSteps}
          sendingWindow={sendingWindow}
          readiness={readiness}
        />
      )}
    </div>
  );
}
