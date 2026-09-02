import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../app/pages/admin/index.vue', import.meta.url), 'utf8')
const auditRoute = readFileSync(new URL('../server/api/workspaces/[id]/audit.get.ts', import.meta.url), 'utf8')
const replayRoute = readFileSync(new URL('../server/api/workspaces/[id]/webhooks/[webhookId]/deliveries/[deliveryId]/replay.post.ts', import.meta.url), 'utf8')

describe('webhook admin states', () => {
  it('shows loading, retryable errors, and a destructive delete confirmation', () => {
    expect(source).toContain('webhooksLoading')
    expect(source).toContain('webhooksError')
    expect(source).toContain('deliveriesError')
    expect(source).toContain('Delete this webhook?')
    expect(source).toContain('Its recent delivery history will also be removed.')
    expect(source).toContain('@click="requestWebhookDelete(w)"')
  })

  it('keeps webhook controls usable on narrow screens', () => {
    expect(source).toContain('flex-wrap items-center')
    expect(source).toContain('flex-col-reverse gap-2 sm:flex-row')
  })

  it('shows durable queue state and exposes an explicit retry action', () => {
    expect(source).toContain('dead_letter: \'Needs attention\'')
    expect(source).toContain('Next try')
    expect(source).toContain('Retry now')
    expect(source).toContain('replayingDelivery')
    expect(source).toContain('Automatic delivery is paused by the Perch operator')
  })

  it('redacts historical webhook paths before returning audit entries', () => {
    expect(auditRoute).toContain(`row.action.startsWith('webhook.')`)
    expect(auditRoute).toContain('webhookAuditTarget(detail.url)')
  })

  it('limits replay to admins and uses a client idempotency key', () => {
    expect(replayRoute).toContain('requireMembership(event, workspaceId, { admin: true })')
    expect(replayRoute).toContain('assertRateLimit(\'webhook-replay:member\'')
    expect(replayRoute).toContain('request_id: z.string().uuid()')
  })
})
