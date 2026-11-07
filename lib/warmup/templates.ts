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

// --- Composed messages ------------------------------------------------------
// Six fixed bodies meant the same few hundred bytes were exchanged over and
// over between the same mailboxes, and identical repeated content is a
// fingerprint filters key on. Messages are now composed from independent
// parts — greeting, opener, body, sign-off, plus a subject — which yields
// tens of thousands of distinct combinations, while staying short,
// informal and free of anything resembling sales copy.

const GREETINGS = ["Hi {name},", "Hey {name},", "Hello {name},", "Hi there,", "Hey,", "Morning {name},", "Hi {name} —", "Good to hear from you {name},"];

const OPENERS = [
  "Hope your week is going well.",
  "Hope things are good on your side.",
  "Quick note while I think of it.",
  "Just catching up on a few emails today.",
  "Hope you had a good weekend.",
  "Hope the day is treating you well.",
  "Thanks again for the help earlier.",
  "Trying to clear my inbox before the afternoon.",
  "",
];

const BODIES = [
  "Did you get a chance to look at the notes from last time? No rush at all.",
  "I moved our catch-up to later in the week, let me know if that still works for you.",
  "I found the document I mentioned, I'll send it over once I've tidied it up.",
  "Can we pick this up again next week? This week got away from me.",
  "Just confirming I've got everything I need for now. Thanks!",
  "I'm putting together a short summary and will share it when it's ready.",
  "Let me know if you want me to add anything before Friday.",
  "I had a quick look and everything seems to be in order.",
  "Following up on our chat — I think we're aligned on the next steps.",
  "I'll be out for part of tomorrow, so replies might be a bit slower.",
  "Sharing a quick update: the first part is done, working on the rest now.",
  "Do you still have the link from the other day? I can't seem to find it.",
  "Happy to jump on a call if that's easier than email.",
  "Noting this down so we don't lose track of it.",
];

const SIGN_OFFS = ["Thanks!", "Cheers,", "Talk soon,", "Best,", "Thanks so much,", "Speak soon,", "All the best,", "Have a good one,"];

const SUBJECTS = [
  "Quick question",
  "Following up",
  "Catch up this week?",
  "Notes from earlier",
  "Small update",
  "Re: next steps",
  "Checking in",
  "A couple of things",
  "Thanks for today",
  "Before Friday",
  "Quick favour",
  "Plan for next week",
  "That link",
  "Sharing this",
  "Touching base",
];

const REPLY_OPENERS = ["Thanks for this!", "Got it, thanks.", "Thanks for the update.", "Appreciate it.", "Perfect, thank you.", "Thanks — all good here.", "Nice one, thanks."];

const REPLY_BODIES = [
  "That works for me.",
  "Sounds like a plan, let's go with that.",
  "No rush on my side either.",
  "I'll take a look later today.",
  "Let's pick it up next week then.",
  "Makes sense, I'll keep an eye out for it.",
  "Received, I'll get back to you if anything comes up.",
  "Great, that's everything I needed.",
  "",
];

function pick<T>(pool: readonly T[], random: () => number): T {
  return pool[Math.floor(random() * pool.length)];
}

function firstName(displayName: string | null | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first && /^[\p{L}'-]{1,40}$/u.test(first) ? first : null;
}

function withName(template: string, name: string | null): string {
  if (name) return template.replace("{name}", name);
  // No usable name: drop it, and any separator it leaves dangling.
  return template.replace(/ \{name\}/, "").replace("{name}", "").replace(" —", ",");
}

export interface ComposedMessage {
  subject: string;
  body: string;
}

export function composeInitialMessage(
  recipientDisplayName: string | null | undefined,
  senderDisplayName: string | null | undefined,
  random: () => number = Math.random,
): ComposedMessage {
  const lines = [
    withName(pick(GREETINGS, random), firstName(recipientDisplayName)),
    [pick(OPENERS, random), pick(BODIES, random)].filter(Boolean).join(" "),
    [pick(SIGN_OFFS, random), firstName(senderDisplayName)].filter(Boolean).join("\n"),
  ];
  return { subject: pick(SUBJECTS, random), body: lines.join("\n\n") };
}

export function composeReplyMessage(senderDisplayName: string | null | undefined, random: () => number = Math.random): string {
  const lines = [
    [pick(REPLY_OPENERS, random), pick(REPLY_BODIES, random)].filter(Boolean).join(" "),
    [pick(SIGN_OFFS, random), firstName(senderDisplayName)].filter(Boolean).join("\n"),
  ];
  return lines.join("\n\n");
}
