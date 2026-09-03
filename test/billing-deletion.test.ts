import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { confirmSubscriptionWillNotRenew } from '../server/utils/billing-deletion'
import type { BachsSubscription } from '../server/utils/bachs'

function subscription(
  id: string,
  status: BachsSubscription['status'] = 'active',
  cancelAtPeriodEnd = false
): BachsSubscription {
  return {
    id,
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    current_period_end: '2026-10-01T00:00:00.000Z',
    metadata: null
  }
}

describe('billing-safe deletion provider confirmation', () => {
  it('ships a linear migration with a minimal non-personal receipt', () => {
    const journal = JSON.parse(readFileSync(new URL('../packages/db/migrations/meta/_journal.json', import.meta.url), 'utf8'))
    const migration = readFileSync(new URL('../packages/db/migrations/0031_billing_deletion_safety.sql', import.meta.url), 'utf8')
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 31))
      .toMatchObject({ tag: '0031_billing_deletion_safety' })
    expect(migration).toContain('"deletion_requested_at"')
    expect(migration).toContain('"billing_deletion_receipts"')
    expect(migration).not.toMatch(/email|workspace_name|actor_id|amount/i)
  })

  it('does not contact Bachs when no provider subscription exists', async () => {
    const getSubscription = vi.fn()
    const cancelSubscription = vi.fn()
    await expect(confirmSubscriptionWillNotRenew(
      { workspaceId: 'workspace-free', subscriptionId: null },
      { getSubscription, cancelSubscription }
    )).resolves.toMatchObject({
      providerStatus: 'not_applicable',
      providerConfirmedAt: null
    })
    expect(getSubscription).not.toHaveBeenCalled()
    expect(cancelSubscription).not.toHaveBeenCalled()
  })

  it.each([
    subscription('sub-canceled', 'canceled'),
    subscription('sub-scheduled', 'active', true)
  ])('accepts provider-fresh proof that renewal is already disabled', async (current) => {
    const cancelSubscription = vi.fn()
    const result = await confirmSubscriptionWillNotRenew(
      { workspaceId: 'workspace-1', subscriptionId: current.id },
      { getSubscription: vi.fn().mockResolvedValue(current), cancelSubscription }
    )
    expect(result.providerStatus).toBe(current.status)
    expect(result.providerConfirmedAt).toBeInstanceOf(Date)
    expect(cancelSubscription).not.toHaveBeenCalled()
  })

  it('cancels an active subscription with a stable idempotency key', async () => {
    const cancelSubscription = vi.fn().mockResolvedValue(subscription('sub-1', 'active', true))
    const dependencies = {
      getSubscription: vi.fn().mockResolvedValue(subscription('sub-1')),
      cancelSubscription
    }
    await confirmSubscriptionWillNotRenew(
      { workspaceId: 'workspace-1', subscriptionId: 'sub-1' },
      dependencies
    )
    await confirmSubscriptionWillNotRenew(
      { workspaceId: 'workspace-1', subscriptionId: 'sub-1' },
      dependencies
    )
    expect(cancelSubscription).toHaveBeenCalledTimes(2)
    expect(cancelSubscription.mock.calls[0]?.[1]).toBe('perch-delete-workspace-1-sub-1')
    expect(cancelSubscription.mock.calls[1]?.[1]).toBe('perch-delete-workspace-1-sub-1')
  })

  it.each([
    ['timeout', Object.assign(new Error('timeout'), { statusCode: 503 })],
    ['malformed response', Object.assign(new Error('invalid subscription'), { statusCode: 502 })],
    ['provider failure', Object.assign(new Error('provider unavailable'), { statusCode: 503 })]
  ])('fails closed on %s', async (_name, providerError) => {
    await expect(confirmSubscriptionWillNotRenew(
      { workspaceId: 'workspace-1', subscriptionId: 'sub-1' },
      {
        getSubscription: vi.fn().mockRejectedValue(providerError),
        cancelSubscription: vi.fn()
      }
    )).rejects.toBe(providerError)
  })

  it('rejects a mismatched subscription returned by either provider call', async () => {
    await expect(confirmSubscriptionWillNotRenew(
      { workspaceId: 'workspace-1', subscriptionId: 'sub-expected' },
      {
        getSubscription: vi.fn().mockResolvedValue(subscription('sub-wrong')),
        cancelSubscription: vi.fn()
      }
    )).rejects.toMatchObject({ statusCode: 502 })

    await expect(confirmSubscriptionWillNotRenew(
      { workspaceId: 'workspace-1', subscriptionId: 'sub-expected' },
      {
        getSubscription: vi.fn().mockResolvedValue(subscription('sub-expected')),
        cancelSubscription: vi.fn().mockResolvedValue(subscription('sub-wrong', 'active', true))
      }
    )).rejects.toMatchObject({ statusCode: 502 })
  })

  it('rejects cancellation responses that still permit renewal', async () => {
    await expect(confirmSubscriptionWillNotRenew(
      { workspaceId: 'workspace-1', subscriptionId: 'sub-1' },
      {
        getSubscription: vi.fn().mockResolvedValue(subscription('sub-1')),
        cancelSubscription: vi.fn().mockResolvedValue(subscription('sub-1'))
      }
    )).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: 'Bachs did not confirm that renewal was canceled. Nothing was deleted.'
    })
  })
})
