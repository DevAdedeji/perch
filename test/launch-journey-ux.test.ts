import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('launch journey continuity', () => {
  const onboarding = source('../app/pages/onboarding.vue')
  const middleware = source('../app/middleware/auth.global.ts')
  const pricing = source('../app/pages/pricing.vue')
  const signup = source('../app/pages/signup.vue')
  const login = source('../app/pages/login.vue')

  it('keeps onboarding resumable without claiming the widget is already live', () => {
    expect(middleware).toContain('to.query.continue === \'invites\' || to.query.continue === \'install\'')
    expect(onboarding).toContain('setContinuation(\'invites\')')
    expect(onboarding).toContain('setContinuation(\'install\')')
    expect(onboarding).toContain('Your workspace is ready')
    expect(onboarding).not.toContain('You’re live!')
  })

  it('preserves invite redirects when switching authentication methods', () => {
    expect(signup).toContain('`/login?redirect=${encodeURIComponent(redirect.value)}`')
    expect(login).toContain('`/signup?redirect=${encodeURIComponent(redirect.value)}`')
    expect(middleware).toContain('encodeURIComponent(to.fullPath)')
  })

  it('carries Pro intent through signup and onboarding to billing', () => {
    expect(pricing).toContain('\'/onboarding?plan=pro\'')
    expect(onboarding).toContain('proIntent.value ? \'/billing\' : \'/installation\'')
  })
})

describe('invite lifecycle and destination', () => {
  const inviteRoute = source('../server/api/workspaces/[id]/invites.post.ts')
  const joinPage = source('../app/pages/join/[token].vue')

  it('counts only unexpired pending invites against free member capacity', () => {
    expect(inviteRoute).toContain('eq(invites.status, \'pending\')')
    expect(inviteRoute).toContain('gt(invites.expiresAt, now)')
  })

  it('selects the accepted workspace before opening the dashboard', () => {
    const setWorkspace = joinPage.indexOf('setWorkspace(result.workspaceId)')
    const dashboard = joinPage.indexOf('navigateTo(\'/dashboard\')')

    expect(setWorkspace).toBeGreaterThan(-1)
    expect(dashboard).toBeGreaterThan(setWorkspace)
  })
})

describe('launch page recovery and accessibility', () => {
  const billing = source('../app/pages/billing.vue')
  const dashboard = source('../app/pages/dashboard.vue')
  const installation = source('../app/pages/installation.vue')
  const team = source('../app/pages/team.vue')
  const onboarding = source('../app/pages/onboarding.vue')

  it('keeps billing truthful and retryable', () => {
    expect(billing).toContain('Plans and billing could not load')
    expect(billing).toContain('Checking your payment')
    expect(billing).not.toContain('Checkout completed')
    expect(billing).toContain('Payment status could not be refreshed')
  })

  it('routes domain recovery to the real admin controls', () => {
    expect(installation).toContain('to="/admin"')
    expect(installation).not.toContain('to="/settings"')
  })

  it('distinguishes a filtered inbox from a new inbox and offers a next action', () => {
    expect(dashboard).toContain('No conversations match these filters')
    expect(dashboard).toContain('Clear filters')
    expect(dashboard).toContain('Install or test Perch')
  })

  it('keys team rosters by workspace and confirms named removals', () => {
    expect(team).toContain('useState<Record<string, Member[]>>(\'team:membersByWorkspace\'')
    expect(team).toContain('`Remove ${pendingRemoval?.name ?? \'this teammate\'}?`')
    expect(team).toContain(':aria-label="`Remove ${m.name}`"')
  })

  it('labels and stacks onboarding invite controls for narrow screens', () => {
    expect(onboarding).toContain(':label="`Teammate ${i + 1} email`"')
    expect(onboarding).toContain('sm:grid-cols-[minmax(0,1fr)_8rem_auto]')
    expect(onboarding).toContain('Admins can manage billing, installation, teammates, security settings, and workspace deletion.')
  })
})
