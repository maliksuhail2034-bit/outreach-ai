// How long after a subscription's current_period_end its plan access
// continues when no newer period has been recorded.
//
// BUSINESS DECISION — 3-day grace period approved 2026-09-30. Some window is technically
// required: a renewal is charged at the period boundary and the webhook that
// records the new period arrives afterwards, and a past_due subscription
// keeps access while the provider retries the charge (see
// subscription-view.ts's GRANTING_STATUSES). Zero would cut every renewing
// customer off at each boundary. The value itself — how long access may
// outlive a period the provider hasn't confirmed as renewed — is a product
// call, not a technical one.
export const ENTITLEMENT_PERIOD_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
