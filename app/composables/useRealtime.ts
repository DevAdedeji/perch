import { createRealtimeClient, type RealtimeStatus } from '@/utils/realtime-client'

let client: ReturnType<typeof createRealtimeClient> | undefined

export function useRealtime() {
  const status = useState<RealtimeStatus>('rt:status', () => 'idle')
  function connection() {
    if (!import.meta.client) return
    client ??= createRealtimeClient({
      ticket: () => $fetch<{ ticket: string }>('/api/realtime/ticket'),
      socket: (ticket) => {
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
        return new WebSocket(
          `${protocol}://${location.host}/api/ws?ticket=${encodeURIComponent(ticket)}`
        )
      },
      onStatus: (next) => { status.value = next }
    })
    return client
  }

  return {
    status,
    connect: () => connection()?.connect(),
    disconnect: () => connection()?.disconnect(),
    subscribe: (channel: string) => connection()?.subscribe(channel),
    unsubscribe: (channel: string) => connection()?.unsubscribe(channel),
    on: (handler: Parameters<NonNullable<typeof client>['on']>[0]) => connection()?.on(handler) ?? (() => {}),
    onReconnect: (handler: () => void) => connection()?.onReconnect(handler) ?? (() => {}),
    sendTyping: (id: string, typing: boolean) => connection()?.sendTyping(id, typing),
    sendPresence: (id: string, presence: 'online' | 'away') => connection()?.sendPresence(id, presence)
  }
}
