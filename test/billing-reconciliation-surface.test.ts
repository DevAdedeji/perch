import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('billing reconciliation surface', () => {
  const route = source('../server/api/workspaces/[id]/billing/refresh.post.ts')
  const page = source('../app/pages/billing.vue')
  const checkout = source('../server/api/workspaces/[id]/billing/checkout.post.ts')
  const billing = source('../server/utils/billing.ts')
  const worker = source('../server/plugins/billing-reconciliation-sweep.ts')
  const migration = source('../packages/db/migrations/0029_fair_hiroim.sql')
  const operatorMetrics = source('../server/api/admin/metrics.get.ts')
  const launchConfig = source('../config/launch.ts')
  const webhook = source('../server/api/webhooks/bachs.post.ts')

  it('keeps reconciliation admin-only, rate-limited, and provider-backed', () => {
    expect(route).toContain('requireMembership(event, workspaceId, { admin: true })')
    expect(route).toContain('assertRateLimit(\'billing-refresh:member\'')
    expect(route).toContain('reconcileWorkspaceBilling(workspaceId)')
    expect(route).toContain('logAudit(workspaceId, user, \'billing.reconciled\'')
  })

  it('offers an honest manual recovery action without opening checkout', () => {
    expect(page).toContain('Check Bachs status')
    expect(page).toContain('method: \'POST\'')
    expect(page).toContain('Pro remains off')
    expect(page).not.toContain('Nothing was changed')
    expect(page).toContain('waiting for the signed subscription confirmation')
    expect(page).toContain('cancel renewal before starting another checkout')
    expect(billing).toContain('must be canceled before starting another checkout')
    expect(page).not.toContain('setTimeout(() => pollForPaymentConfirmation')
    expect(checkout).toContain('billingCheckoutEnabled()')
    expect(checkout.indexOf('billingCheckoutEnabled()')).toBeLessThan(checkout.indexOf('readValidatedBody'))
    expect(launchConfig).toContain('BACHS_RECURRING_RESPONSE_CONTRACT_VERIFIED = false')
    expect(billing).toContain('BACHS_RECURRING_RESPONSE_CONTRACT_VERIFIED')
  })

  it('keeps automatic recovery bounded, durable, and disabled in local tests', () => {
    expect(billing).toContain('const RECONCILIATION_SWEEP_LIMIT = 5')
    expect(billing).toContain('providerRequestCap: result.providerResourcesChecked * BACHS_MAX_GET_ATTEMPTS')
    expect(worker).toContain('import.meta.dev || import.meta.test')
    expect(worker).toContain('BILLING_RECONCILIATION_INTERVAL_MS = 60_000')
    expect(worker).toContain('sweep completed with failed jobs')
    expect(billing).toContain('Verify your email address before starting a paid subscription')
    expect(migration).toContain('billing_reconciliation_jobs')
    expect(migration).toContain('workspace_invoices_open_checkout_uq')
    expect(migration).toContain('WHERE "checkout_closed_at" IS NULL AND "bachs_checkout_id" IS NOT NULL')
    expect(migration).toContain('AND "invoice"."bachs_checkout_id" IS NOT NULL')
    expect(billing).toContain('still pending after its bounded verification window')
    expect(page).toContain('unresolved checkout exceeded its bounded verification window')
    expect(webhook).toContain('await requireBillingWebhookFinish(')
  })

  it('exposes durable financial and dead-letter attention globally without secrets or customer data', () => {
    expect(operatorMetrics).toContain('billingFinancialConflicts')
    expect(operatorMetrics).toContain('billingReconciliationJobs.status, \'failed\'')
    expect(operatorMetrics).toContain('billingWebhookDeliveries.status, \'failed\'')
    expect(operatorMetrics).toContain('sanitizedBillingError')
    expect(operatorMetrics).not.toContain('providerEventId:')
    expect(page).toContain('Duplicate subscription needs financial review')
  })
})
