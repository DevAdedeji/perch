import type { Peer } from 'crossws'
import type { WsEvent } from '@perch/shared'

/**
 * In-process real-time fan-out (§5.4). Everything that broadcasts goes through
 * `publish()`; connections register via `subscribe()`. v1 runs on a single
 * instance so an in-memory registry is enough — swapping this file for a Redis
 * pub/sub implementation is the entire horizontal-scaling change.
 *
 * Kept on `globalThis` so the WS handler and REST routes share one registry and
 * it survives dev HMR module reloads.
 */
interface Registry {
  channels: Map<string, Set<Peer>>
}

const g = globalThis as unknown as { __perchRealtime?: Registry }
const registry: Registry = (g.__perchRealtime ??= { channels: new Map() })

export function subscribe(channel: string, peer: Peer): void {
  let set = registry.channels.get(channel)
  if (!set) {
    set = new Set()
    registry.channels.set(channel, set)
  }
  set.add(peer)
}

export function unsubscribe(channel: string, peer: Peer): void {
  const set = registry.channels.get(channel)
  if (!set) return
  set.delete(peer)
  if (set.size === 0) registry.channels.delete(channel)
}

/** Drop a peer from every channel (on disconnect). */
export function unsubscribeAll(peer: Peer): void {
  for (const [channel, set] of registry.channels) {
    set.delete(peer)
    if (set.size === 0) registry.channels.delete(channel)
  }
}

/**
 * Fan a typed server event out to every peer subscribed to `channel`.
 * `agentsOnly` skips visitor peers — used so internal notes never reach the
 * visitor on the shared `conversation:{id}` channel (§4).
 */
export function publish(channel: string, event: WsEvent, opts?: { agentsOnly?: boolean }): void {
  const set = registry.channels.get(channel)
  if (!set || set.size === 0) return
  const data = JSON.stringify(event)
  for (const peer of set) {
    if (opts?.agentsOnly && peer.context?.role !== 'agent') continue
    try {
      peer.send(data)
    } catch {
      // peer went away between iterations; disconnect cleanup will remove it
    }
  }
}

/** Number of peers on a channel — used for `business.presence` (any agent online?). */
export function subscriberCount(channel: string): number {
  return registry.channels.get(channel)?.size ?? 0
}
