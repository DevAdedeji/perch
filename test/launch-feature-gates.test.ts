import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { explicitlyEnabled } from '../config/launch'
import { cloudinaryUploadAvailable } from '../server/utils/cloudinary'

const checkoutRoute = readFileSync(new URL('../server/api/workspaces/[id]/billing/checkout.post.ts', import.meta.url), 'utf8')
const billingPage = readFileSync(new URL('../app/pages/billing.vue', import.meta.url), 'utf8')
const authRoute = readFileSync(new URL('../server/api/auth/me.get.ts', import.meta.url), 'utf8')
const widgetSessionRoute = readFileSync(new URL('../server/api/widget/session.post.ts', import.meta.url), 'utf8')
const agentComposer = readFileSync(new URL('../app/components/ConversationComposer.vue', import.meta.url), 'utf8')
const widgetPage = readFileSync(new URL('../app/pages/widget.vue', import.meta.url), 'utf8')
const adminPage = readFileSync(new URL('../app/pages/admin/index.vue', import.meta.url), 'utf8')
const landingPage = readFileSync(new URL('../app/pages/index.vue', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

describe('launch feature gates', () => {
  it('enables sensitive features only for the exact true value', () => {
    expect(explicitlyEnabled(undefined)).toBe(false)
    expect(explicitlyEnabled('false')).toBe(false)
    expect(explicitlyEnabled('TRUE')).toBe(false)
    expect(explicitlyEnabled('true')).toBe(true)
  })

  it('requires the complete Cloudinary configuration before exposing uploads', () => {
    expect(cloudinaryUploadAvailable({ cloudName: '', apiKey: '', apiSecret: '' })).toBe(false)
    expect(cloudinaryUploadAvailable({ cloudName: 'perch', apiKey: 'key', apiSecret: '' })).toBe(false)
    expect(cloudinaryUploadAvailable({ cloudName: 'perch', apiKey: 'key', apiSecret: 'secret' })).toBe(true)
  })

  it('blocks direct checkout requests at the server and explains the closed state', () => {
    expect(checkoutRoute.indexOf('billingCheckoutEnabled()')).toBeLessThan(checkoutRoute.indexOf('readValidatedBody'))
    expect(checkoutRoute).toContain('Perch Pro checkout is not open yet.')
    expect(billingPage).toContain(':disabled="!overview.checkoutEnabled"')
    expect(billingPage).toContain('Pro upgrades are not open yet.')
    expect(billingPage).not.toContain('overview.configured')
  })

  it('publishes one server-owned attachment capability to both composers', () => {
    expect(authRoute).toContain('attachmentsAvailable: imageAttachmentsAvailable()')
    expect(widgetSessionRoute).toContain('attachments_available: imageAttachmentsAvailable()')
    expect(agentComposer).toContain('v-if="!internalNote && attachmentsAvailable"')
    expect(agentComposer).not.toContain('Image uploads unavailable')
    expect(widgetPage).toContain('v-if="workspace?.attachments_available"')
    expect(widgetPage).not.toContain('Images unavailable')
  })

  it('keeps existing image rendering and accurately describes durable webhooks', () => {
    expect(widgetPage).toContain('v-if="row.m.attachment_url"')
    expect(adminPage).toContain('durably queues signed events and retries temporary failures')
    expect(adminPage).toContain('New events are not queued while it is paused.')
  })

  it('avoids unsupported launch-speed, delivery-speed, and public-repository promises', () => {
    expect(landingPage).toContain('{ value: \'Live\', label: \'Realtime updates\' }')
    expect(landingPage).toContain('{ value: \'1 owner\', label: \'Per conversation\' }')
    expect(landingPage).not.toMatch(/<1s|Set up in 2 minutes|Double-answered|github\.com\/DevAdedeji\/perch/)
    expect(readme).not.toContain('all open source')
    expect(readme).not.toContain('all free / free-tier')
  })
})
