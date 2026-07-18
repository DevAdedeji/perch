import type { Peer } from 'crossws'
import { channels } from '@perch/shared'
import type { LiveVisitorDTO, WsEvent } from '@perch/shared'

/**
 * In-memory live-visitor registry — the roster's source of truth. A visitor is
 * "on the site" while they hold ≥1 live widget socket; their current page comes
 * from `visitor.page` reports (loader → iframe → WS). Deltas broadcast to
 * `visitors:{id}` (agents only). Single-instance for v1 — same swap-for-Redis
 * story as the realtime bus.
 *
 * Keyed by the visitor's DB row id (`visitors.id`) — the same id conversations
 * reference and the visitor ticket carries as `vid`.
 */
interface VisitorState {
  peers: Set<Peer>
  page: string | null
  pageSince: number
  connectedAt: number
  name: string | null
  email: string | null
  verified: boolean
}
interface WorkspaceVisitors { visitors: Map<string, VisitorState> }

const g = globalThis as unknown as { __perchVisitorPresence?: Map<string, WorkspaceVisitors> }
const store: Map<string, WorkspaceVisitors> = (g.__perchVisitorPresence ??= new Map())

function entry(workspaceId: string): WorkspaceVisitors {
  let e = store.get(workspaceId)
  if (!e) {
    e = { visitors: new Map() }
    store.set(workspaceId, e)
  }
  return e
}

function toDTO(visitorRef: string, v: VisitorState): LiveVisitorDTO {
  return {
    visitor_ref: visitorRef,
    name: v.name,
    email: v.email,
    identity_verified: v.verified,
    page_url: v.page,
    page_since: v.pageSince,
    connected_at: v.connectedAt
  }
}

function announce(workspaceId: string, event: WsEvent) {
  publish(channels.visitors(workspaceId), event)
}

export interface VisitorSnapshot {
  name: string | null
  email: string | null
  verified: boolean
}

/** Register a widget socket. Broadcasts `visitor.online` on the first peer. */
export function visitorConnected(workspaceId: string, visitorRef: string, peer: Peer, snapshot: VisitorSnapshot) {
  const e = entry(workspaceId)
  let v = e.visitors.get(visitorRef)
  if (!v) {
    const now = Date.now()
    v = { peers: new Set(), page: null, pageSince: now, connectedAt: now, ...snapshot }
    e.visitors.set(visitorRef, v)
  } else {
    // refresh the identity snapshot — it may have changed between sessions
    Object.assign(v, snapshot)
  }
  const first = v.peers.size === 0
  v.peers.add(peer)
  if (first) announce(workspaceId, { type: 'visitor.online', payload: toDTO(visitorRef, v) })
}

/**
 * The widget reported the host page. `pageSince` (what trigger dwell is
 * measured from) only resets when the page actually changes — a reconnect
 * re-reporting the same URL keeps the visitor's dwell clock running.
 */
export function visitorPageUpdate(workspaceId: string, visitorRef: string, pageUrl: string) {
  const v = store.get(workspaceId)?.visitors.get(visitorRef)
  if (!v || v.page === pageUrl) return
  v.page = pageUrl
  v.pageSince = Date.now()
  announce(workspaceId, {
    type: 'visitor.page',
    payload: { visitor_ref: visitorRef, page_url: pageUrl, page_since: v.pageSince }
  })
}

/** Identity changed mid-session (Perch.identify) — rebroadcast as an upsert. */
export function visitorIdentified(workspaceId: string, visitorRef: string, snapshot: VisitorSnapshot) {
  const v = store.get(workspaceId)?.visitors.get(visitorRef)
  if (!v) return
  Object.assign(v, snapshot)
  announce(workspaceId, { type: 'visitor.online', payload: toDTO(visitorRef, v) })
}

/** Remove a socket from everywhere (disconnect). Last peer → `visitor.offline`. */
export function visitorPeerGone(peer: Peer) {
  for (const [workspaceId, e] of store) {
    for (const [visitorRef, v] of e.visitors) {
      if (v.peers.delete(peer) && v.peers.size === 0) {
        e.visitors.delete(visitorRef)
        announce(workspaceId, { type: 'visitor.offline', payload: { visitor_ref: visitorRef } })
      }
    }
    if (e.visitors.size === 0) store.delete(workspaceId)
  }
}

/** Roster bootstrap for the dashboard (`GET /visitors/live`). */
export function liveVisitors(workspaceId: string): LiveVisitorDTO[] {
  const e = store.get(workspaceId)
  if (!e) return []
  return [...e.visitors].map(([ref, v]) => toDTO(ref, v))
}

/** Workspaces with anyone on-site right now (the trigger sweep's outer loop). */
export function liveWorkspaceIds(): string[] {
  return [...store.keys()]
}

/** Push an event straight to one visitor's widget socket(s). */
export function sendToVisitor(workspaceId: string, visitorRef: string, event: WsEvent): boolean {
  const v = store.get(workspaceId)?.visitors.get(visitorRef)
  if (!v || v.peers.size === 0) return false
  const data = JSON.stringify(event)
  for (const peer of v.peers) {
    try {
      peer.send(data)
    } catch {
      // dead peer — cleaned up on its close/error hook
    }
  }
  return true
}
