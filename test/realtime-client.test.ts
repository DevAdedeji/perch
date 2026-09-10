import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRealtimeClient } from '@/utils/realtime-client'

class TestSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 3
    this.onclose?.()
  })

  open() {
    this.readyState = 1
    this.onopen?.()
  }
}

function harness(ticket = vi.fn().mockResolvedValue({ ticket: 'test' })) {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', { OPEN: 1, CONNECTING: 0 })
  const sockets: TestSocket[] = []
  const onStatus = vi.fn()
  const client = createRealtimeClient({
    ticket,
    socket: () => {
      const socket = new TestSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    onStatus
  })
  return { client, sockets, onStatus, ticket }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('realtime session lifecycle', () => {
  it('reconnects and restores subscriptions after a dropped connection', async () => {
    const { client, sockets } = harness()
    const reconnect = vi.fn()
    client.onReconnect(reconnect)
    client.subscribe('workspace:one')
    await vi.advanceTimersByTimeAsync(0)
    sockets[0]!.open()
    expect(sockets[0]!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', channel: 'workspace:one' }))
    sockets[0]!.close()
    await vi.advanceTimersByTimeAsync(500)
    sockets[1]!.open()
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(sockets[1]!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', channel: 'workspace:one' }))
    client.disconnect()
  })

  it('cancels an in-flight ticket when signing out', async () => {
    let resolve!: (value: { ticket: string }) => void
    const ticket = vi.fn(() => new Promise<{ ticket: string }>((done) => {
      resolve = done
    }))
    const { client, sockets, onStatus } = harness(ticket)
    const connecting = client.connect()
    client.disconnect()
    resolve({ ticket: 'old-session' })
    await connecting
    expect(sockets).toHaveLength(0)
    expect(onStatus).toHaveBeenLastCalledWith('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not reconnect or retain listeners and channels after logout', async () => {
    const { client, sockets, ticket } = harness()
    const handler = vi.fn()
    client.on(handler)
    client.subscribe('old-private-channel')
    await vi.advanceTimersByTimeAsync(0)
    sockets[0]!.open()
    client.disconnect()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(ticket).toHaveBeenCalledTimes(1)
    await client.connect()
    sockets[1]!.open()
    sockets[1]!.onmessage?.({ data: JSON.stringify({ type: 'test-event' }) })
    expect(handler).not.toHaveBeenCalled()
    expect(sockets[1]!.send).not.toHaveBeenCalled()
    client.disconnect()
  })

  it('ignores late events from an old socket and malformed control messages', async () => {
    const { client, sockets, onStatus } = harness()
    await client.connect()
    const old = sockets[0]!
    old.open()
    client.disconnect()
    const handler = vi.fn()
    client.on(handler)
    await client.connect()
    sockets[1]!.open()
    old.onclose?.()
    old.onmessage?.({ data: '{"type":"old-event"}' })
    for (const data of ['null', '[]', 'false', 'bad-json', '{"type":"pong"}']) {
      expect(() => sockets[1]!.onmessage?.({ data })).not.toThrow()
    }
    expect(onStatus).toHaveBeenLastCalledWith('open')
    expect(handler).not.toHaveBeenCalled()
    client.disconnect()
  })

  it('closes an unresponsive socket so the next connection can catch up', async () => {
    const { client, sockets } = harness()
    await client.connect()
    sockets[0]!.open()
    await vi.advanceTimersByTimeAsync(75_000)
    expect(sockets[0]!.close).toHaveBeenCalledTimes(1)
    client.disconnect()
  })
})
