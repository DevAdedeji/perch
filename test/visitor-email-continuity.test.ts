import { describe, expect, it } from 'vitest'
import {
  maskVisitorEmail,
  normalizeVisitorEmail,
  replyEmailRetryAt,
  runVisitorReplyEmailSweep,
  signReplyPayload,
  verifyReplyPayload,
  visitorEmailHash,
  visitorReplyEmailHtml
} from '../server/utils/visitor-email-continuity'

describe('visitor email continuity security helpers', () => {
  const secret = 'visitor-reply-test-secret-with-32-characters'

  it('normalizes, hashes, and masks visitor email consistently', () => {
    expect(normalizeVisitorEmail(' Ada@Example.COM ')).toBe('ada@example.com')
    expect(visitorEmailHash(' Ada@Example.COM ')).toBe(visitorEmailHash('ada@example.com'))
    expect(maskVisitorEmail('ada@example.com')).toBe('a••@example.com')
  })

  it('keeps open, unsubscribe, and session tokens purpose-bound', () => {
    const token = signReplyPayload({ purpose: 'open', deliveryId: 'delivery-1', exp: 200 }, secret)
    expect(verifyReplyPayload(token, secret, 'open', 100)).toMatchObject({ deliveryId: 'delivery-1' })
    expect(verifyReplyPayload(token, secret, 'unsubscribe', 100)).toBeNull()
    expect(verifyReplyPayload(`${token}x`, secret, 'open', 100)).toBeNull()
    expect(verifyReplyPayload(token, 'another-secret-with-at-least-32-characters', 'open', 100)).toBeNull()
    expect(verifyReplyPayload(token, secret, 'open', 201)).toBeNull()
  })

  it('binds a return session to one exact delivery, visitor, workspace, and conversation', () => {
    const token = signReplyPayload({
      purpose: 'session',
      deliveryId: 'delivery-1',
      workspaceId: 'workspace-1',
      visitorRef: 'visitor-1',
      conversationId: 'conversation-1',
      exp: 200
    }, secret)
    expect(verifyReplyPayload(token, secret, 'session', 100)).toEqual({
      purpose: 'session',
      deliveryId: 'delivery-1',
      workspaceId: 'workspace-1',
      visitorRef: 'visitor-1',
      conversationId: 'conversation-1',
      exp: 200
    })
    expect(verifyReplyPayload(token, secret, 'open', 100)).toBeNull()
  })

  it('uses bounded exponential retry delays', () => {
    const now = new Date('2026-09-02T10:00:00Z')
    expect(replyEmailRetryAt(1, now).toISOString()).toBe('2026-09-02T10:01:00.000Z')
    expect(replyEmailRetryAt(3, now).toISOString()).toBe('2026-09-02T10:30:00.000Z')
    expect(replyEmailRetryAt(5, now).toISOString()).toBe('2026-09-02T16:00:00.000Z')
  })

  it('keeps the production transport inert while the delivery gate is off', async () => {
    Object.assign(globalThis, {
      useRuntimeConfig: () => ({ visitorReplyEmailDeliveryEnabled: false })
    })
    await expect(runVisitorReplyEmailSweep()).resolves.toEqual({ processed: 0 })
  })

  it('builds a generic email without customer message or private context', () => {
    const html = visitorReplyEmailHtml({
      workspaceName: '<Northstar>',
      openUrl: 'https://useperch.xyz/reply?token=open',
      unsubscribeUrl: 'https://useperch.xyz/reply/unsubscribe?token=stop'
    })
    expect(html).toContain('&lt;Northstar&gt; replied')
    expect(html).toContain('message is not shown in this email')
    expect(html).toContain('View reply securely')
    expect(html).not.toContain('sensitive customer message')
    expect(html).not.toContain('<Northstar>')
  })
})
