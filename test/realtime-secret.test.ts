import { describe, expect, it } from 'vitest'
import { resolveRealtimeSecret } from '../server/utils/realtime-secret'

const RUNTIME_SECRET = 'runtime-secret-that-is-at-least-32-characters'
const REALTIME_SECRET = 'realtime-secret-that-is-at-least-32-characters'
const SESSION_SECRET = 'session-secret-that-is-at-least-32-characters'

describe('resolveRealtimeSecret', () => {
  it('uses one deterministic precedence order for all signed sessions', () => {
    expect(resolveRealtimeSecret({
      runtimeSecret: RUNTIME_SECRET,
      realtimeSecret: REALTIME_SECRET,
      sessionSecret: SESSION_SECRET
    })).toBe(RUNTIME_SECRET)

    expect(resolveRealtimeSecret({
      runtimeSecret: '',
      realtimeSecret: REALTIME_SECRET,
      sessionSecret: SESSION_SECRET
    })).toBe(REALTIME_SECRET)

    expect(resolveRealtimeSecret({ sessionSecret: SESSION_SECRET })).toBe(SESSION_SECRET)
  })

  it('fails closed when the selected secret is missing or too short', () => {
    expect(resolveRealtimeSecret({})).toBeNull()
    expect(resolveRealtimeSecret({
      runtimeSecret: 'too-short',
      sessionSecret: SESSION_SECRET
    })).toBeNull()
  })
})
