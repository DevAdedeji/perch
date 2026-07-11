import { describe, expect, it } from 'vitest'
import { signTicket, verifyTicket } from '../server/utils/ws-ticket'

const SECRET = 'test-secret-at-least-32-characters-long'

describe('WebSocket auth tickets', () => {
  it('round-trips an agent ticket', () => {
    const token = signTicket({ role: 'agent', uid: 'user-1' }, SECRET)
    expect(verifyTicket(token, SECRET)).toEqual({ role: 'agent', uid: 'user-1' })
  })

  it('round-trips a visitor ticket scoped to workspace + visitor', () => {
    const token = signTicket({ role: 'visitor', wid: 'ws-1', vid: 'v-1' }, SECRET)
    expect(verifyTicket(token, SECRET)).toEqual({ role: 'visitor', wid: 'ws-1', vid: 'v-1' })
  })

  it('rejects a ticket signed with a different secret', () => {
    const token = signTicket({ role: 'agent', uid: 'user-1' }, 'another-secret-that-is-not-the-real-one')
    expect(verifyTicket(token, SECRET)).toBeNull()
  })

  it('rejects an expired ticket', () => {
    const token = signTicket({ role: 'agent', uid: 'user-1' }, SECRET, -1000)
    expect(verifyTicket(token, SECRET)).toBeNull()
  })

  it('rejects a tampered payload — a visitor cannot promote itself to agent', () => {
    const token = signTicket({ role: 'visitor', wid: 'ws-1', vid: 'v-1' }, SECRET)
    const [data, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(data!, 'base64url').toString())
    payload.role = 'agent'
    payload.uid = 'user-1'
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`
    expect(verifyTicket(forged, SECRET)).toBeNull()
  })

  it('rejects garbage tokens', () => {
    expect(verifyTicket('not-a-ticket', SECRET)).toBeNull()
    expect(verifyTicket('a.b', SECRET)).toBeNull()
    expect(verifyTicket('', SECRET)).toBeNull()
  })
})
