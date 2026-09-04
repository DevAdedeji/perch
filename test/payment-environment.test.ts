import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function response(environment: string, key: string) {
  const setHeader = vi.fn()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setHeader', setHeader)
  vi.stubGlobal('useRuntimeConfig', () => ({ bachsEnvironment: environment, bachsSecretKey: key }))
  vi.stubEnv('BACHS_ENV', '')
  vi.stubEnv('BACHS_SECRET_KEY', '')
  const { default: handler } = await import('../server/api/payment-environment.get')
  const result = handler({} as never)
  return { result, setHeader }
}

describe('public payment environment', () => {
  it('returns only the verified sandbox mode, never credentials, and disables caching', async () => {
    const { result, setHeader } = await response('sandbox', 'sk_sandbox_private-test-value')
    expect(result).toEqual({ mode: 'sandbox' })
    expect(setHeader).toHaveBeenCalledWith({}, 'Cache-Control', 'no-store')
  })

  it('never labels a live or mismatched key as sandbox', async () => {
    expect((await response('live', 'sk_live_private-test-value')).result).toEqual({ mode: 'live' })
    expect((await response('sandbox', 'sk_live_private-test-value')).result).toEqual({ mode: 'disabled' })
    expect((await response('', '')).result).toEqual({ mode: 'disabled' })
  })
})
