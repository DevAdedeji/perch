export const billingIntervals = ['monthly', 'yearly'] as const
export type BillingInterval = typeof billingIntervals[number]

export const subscriptionStatuses = ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled'] as const
export type SubscriptionStatus = typeof subscriptionStatuses[number]

export const PERCH_PRO_PLAN = {
  name: 'Pro',
  currency: 'USD',
  monthlyCents: 900,
  yearlyCents: 9000,
  freeMemberLimit: 2,
  freeReminderMinutes: 15
} as const

export function proPriceCents(interval: BillingInterval) {
  return interval === 'yearly' ? PERCH_PRO_PLAN.yearlyCents : PERCH_PRO_PLAN.monthlyCents
}

export function toDecimalString(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}
