import { afterEach, expect, it, vi } from 'vitest'
import * as sweeps from '@@/server/infrastructure/background-sweep'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('wakes after API mutations, including failed responses, but not reads or health checks', async () => {
  type Event = { path: string, method: string }
  let afterResponse!: (event: Event) => void
  let onError!: (error: Error, context: { event?: Event }) => void
  const wake = vi.spyOn(sweeps, 'wakeBackgroundSweeps').mockImplementation(() => {})
  vi.stubGlobal('defineNitroPlugin', (plugin: (app: unknown) => void) => plugin({
    hooks: { hook: (name: string, callback: typeof afterResponse & typeof onError) => {
      if (name === 'afterResponse') afterResponse = callback
      else if (name === 'error') onError = callback
      else throw new Error(`Unexpected hook: ${name}`)
    } }
  }))
  await import('@@/server/plugins/background-activity')
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) afterResponse({ path: '/api/conversations/123/messages', method })
  expect(wake).toHaveBeenCalledTimes(4)
  for (const path of ['/api/health', '/api/live', '/api/workspaces/123', '/']) {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) afterResponse({ path, method })
  }
  afterResponse({ path: '/other', method: 'POST' })
  expect(wake).toHaveBeenCalledTimes(4)
  onError(new Error('response failed after commit'), { event: { path: '/api/webhooks/bachs', method: 'POST' } })
  expect(wake).toHaveBeenCalledTimes(5)
  onError(new Error('unrelated'), {})
  onError(new Error('read failed'), { event: { path: '/api/workspaces', method: 'GET' } })
  expect(wake).toHaveBeenCalledTimes(5)
})
