// Content pools for warmup messages — short, human-sounding, non-repetitive
// text so consecutive warmup emails between the same two mailboxes don't
// look identical (a spam signal on its own). Pure data + pure selection
// helper, no AI dependency, no I/O — matches this codebase's existing
// "pure math, no side effects" modules (lib/email/scheduling.ts,
// lib/warmup/scheduler.ts).

export interface InitialTemplate {
  id: string;
  subject: string;
  body: string;
}

export interface ReplyTemplate {
  id: string;
  body: string;
}

// Deliberately short, informal, content-free of anything resembling sales
// language — these are warmup conversations between the owner's own
// mailboxes, not outreach.
export const INITIAL_TEMPLATES: InitialTemplate[] = [
  { id: "checking-in", subject: "Quick check-in", body: "Hey, just making sure this address is working on my end. Let me know if it landed okay." },
  { id: "weekly-note", subject: "Weekly note", body: "Hi — sending a quick note to keep things ticking over here. Hope your week's going well." },
  { id: "test-message", subject: "Test message", body: "Just testing this inbox out today. Nothing important, just a quick hello." },
  { id: "status-update", subject: "Status update", body: "Wanted to drop a short update your way. Everything's looking good from where I'm sitting." },
  { id: "friendly-hello", subject: "Hello!", body: "Hi there — hope you're doing well. Just saying hello and keeping this channel active." },
  { id: "loop-back", subject: "Looping back", body: "Circling back with a short note. Nothing urgent, just staying in touch." },
];

export const REPLY_TEMPLATES: ReplyTemplate[] = [
  { id: "sounds-good", body: "Sounds good, thanks for the note!" },
  { id: "got-it", body: "Got it, thanks — all good on my end." },
  { id: "appreciate-it", body: "Appreciate you checking in. All well here." },
  { id: "noted-thanks", body: "Noted, thanks! Talk soon." },
  { id: "confirmed", body: "Confirmed, received it just fine. Thanks!" },
];

// Picks a random item from `pool`, avoiding an immediate repeat of
// `avoidId` when the pool has more than one entry. Never throws on an
// empty pool's caller mistake — callers own not passing one.
export function pickTemplate<T extends { id: string }>(pool: T[], avoidId?: string | null): T {
  if (pool.length === 0) {
    throw new Error("pickTemplate called with an empty pool.");
  }
  const candidates = pool.length > 1 && avoidId ? pool.filter((item) => item.id !== avoidId) : pool;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}
