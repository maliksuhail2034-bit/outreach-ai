import type { Tables } from "@/types/database.types";

// A lead's email activity for its page: each event labelled with what it
// was, which campaign and step it belonged to, and (for a click) where it
// went. Opens and clicks by security scanners (email_events.is_bot) are
// left out of both the timeline and the counts, and counted separately.
// Sends come from the send log, which knows the step ('sent' events don't).

export interface LeadActivityEntry {
  id: string;
  eventType: string;
  label: string;
  detail: string | null;
  timestamp: string;
}

export interface LeadActivity {
  entries: LeadActivityEntry[];
  counts: { sent: number; opened: number; clicked: number; replied: number };
  botEvents: number;
}

const EVENT_LABEL: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  failed: "Failed",
};

function metadataValue(metadata: Tables<"email_events">["metadata"], key: string): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return metadata[key];
}

function metadataString(metadata: Tables<"email_events">["metadata"], key: string): string | null {
  const value = metadataValue(metadata, key);
  return typeof value === "string" ? value : null;
}

export interface LeadSend {
  id: string;
  campaignId: string;
  stepId: string;
  sentAt: string;
}

export function buildLeadActivity(params: {
  events: Tables<"email_events">[];
  sends: LeadSend[];
  campaignNameById: ReadonlyMap<string, string>;
  // Step id -> its position in its campaign's sequence (1-based).
  stepNumberById: ReadonlyMap<string, number>;
}): LeadActivity {
  const { events, sends, campaignNameById, stepNumberById } = params;
  const counts = { sent: sends.length, opened: 0, clicked: 0, replied: 0 };
  let botEvents = 0;
  const campaignName = (id: string) => campaignNameById.get(id) ?? "A deleted campaign";
  const stepLabel = (id: string | null) => {
    const number = id ? stepNumberById.get(id) : undefined;
    return number ? `Step ${number}` : null;
  };

  const entries: LeadActivityEntry[] = sends.map((send) => ({
    id: send.id,
    eventType: "sent",
    label: "Sent",
    detail: [campaignName(send.campaignId), stepLabel(send.stepId)].filter(Boolean).join(" · "),
    timestamp: send.sentAt,
  }));

  for (const event of events) {
    if (event.event_type === "sent") continue;
    if (event.is_bot) {
      botEvents += 1;
      continue;
    }
    if (event.event_type in counts) counts[event.event_type as keyof typeof counts] += 1;

    const destination = event.event_type === "clicked" ? metadataString(event.metadata, "destinationUrl") : null;
    const parts = [
      event.campaign_id ? campaignName(event.campaign_id) : null,
      stepLabel(metadataString(event.metadata, "sequenceStepId")),
      destination,
      metadataValue(event.metadata, "inferredFromClick") === true ? "Counted from a click (images were blocked)" : null,
    ].filter((part): part is string => Boolean(part));

    entries.push({
      id: event.id,
      eventType: event.event_type,
      label: EVENT_LABEL[event.event_type] ?? event.event_type,
      detail: parts.length > 0 ? parts.join(" · ") : null,
      timestamp: event.created_at,
    });
  }

  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { entries, counts, botEvents };
}
