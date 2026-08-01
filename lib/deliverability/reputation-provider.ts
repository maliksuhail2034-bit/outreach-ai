// Provider-agnostic contract for a mailbox's extended reputation signals —
// inbox placement, sender/domain reputation, blocklist presence, and spam
// filter test results. Exactly one implementation exists today
// (PlaceholderReputationProvider, which performs no real checks) — this
// interface exists so a live provider (Google Postmaster Tools, a seed-list
// inbox-placement service, a blocklist checker, a spam-test API, etc.) can
// be swapped in later without touching any call site that only depends on
// this file. Mirrors lib/deliverability/dns-provider.ts's split exactly.
export interface MailboxReputationSignals {
  inboxPlacementRate: number | null; // 0-100, % of seed-list sends landing in the inbox vs. spam
  blacklisted: boolean | null; // whether the sending domain/IP appears on a known blocklist
  spamTestScore: number | null; // 0-100, result of a spam-filter test send
  reputationScore: number | null; // 0-100, sender reputation from a provider like Google Postmaster
}

export interface ReputationProvider {
  checkMailbox(email: string): Promise<MailboxReputationSignals>;
}
