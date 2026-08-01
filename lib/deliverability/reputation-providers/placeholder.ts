import type { MailboxReputationSignals, ReputationProvider } from "../reputation-provider";

// Performs no real checks — every signal comes back null, an honest "not
// measured" rather than a fabricated number. This is the only
// ReputationProvider implementation today; a live provider is a future
// feature that only needs to implement this same interface and be returned
// from get-reputation-provider.ts — nothing else in the app changes.
export class PlaceholderReputationProvider implements ReputationProvider {
  async checkMailbox(email: string): Promise<MailboxReputationSignals> {
    void email;
    return { inboxPlacementRate: null, blacklisted: null, spamTestScore: null, reputationScore: null };
  }
}
