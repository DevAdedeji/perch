import type { Peer } from 'crossws'
import { channels } from '@perch/shared'
import type { Presence } from '@perch/shared'

/**
 * In-memory presence (§6.5). A member is `online` while they have ≥1 live agent
 * socket in a workspace, `away` if they've toggled it, `offline` otherwise.
 * Agent presence broadcasts to `workspace:{id}`; the derived "any agent online?"
 * broadcasts as `business.presence` to `presence:{id}` (which visitor widgets join).
 * Single-instance for v1 — same swap-for-Redis story as the realtime bus.
 */
interface MemberState { peers: Set<Peer>, away: boolean }
interface WorkspaceState { members: Map<string, MemberState> }

const g = globalThis as unknown as { __perchPresence?: Map<string, WorkspaceState> }
const store: Map<string, WorkspaceState> = (g.__perchPresence ??= new Map())

/** Channel visitors subscribe to for business online/offline updates. */
export function presenceChannel(workspaceId: string): string {
  return `presence:${workspaceId}`
}

function entry(workspaceId: string): WorkspaceState {
  let e = store.get(workspaceId)
  if (!e) {
    e = { members: new Map() }
    store.set(workspaceId, e)
  }
  return e
}

export function memberPresence(workspaceId: string, memberId: string): Presence {
  const m = store.get(workspaceId)?.members.get(memberId)
  if (!m || m.peers.size === 0) return 'offline'
  return m.away ? 'away' : 'online'
}

export function workspacePresences(workspaceId: string): Record<string, Presence> {
  const out: Record<string, Presence> = {}
  const e = store.get(workspaceId)
  if (e) {
    for (const [id, m] of e.members) {
      if (m.peers.size > 0) out[id] = m.away ? 'away' : 'online'
    }
  }
  return out
}

export function isBusinessOnline(workspaceId: string): boolean {
  return businessPresence(workspaceId) === 'online'
}

/**
 * The team's presence as the visitor widget shows it: `online` when anyone is
 * actively here, `away` when people are connected but all stepped away,
 * `offline` when nobody is connected at all.
 */
export function businessPresence(workspaceId: string): Presence {
  const e = store.get(workspaceId)
  if (!e) return 'offline'
  let anyConnected = false
  for (const m of e.members.values()) {
    if (m.peers.size > 0) {
      if (!m.away) return 'online'
      anyConnected = true
    }
  }
  return anyConnected ? 'away' : 'offline'
}

function announceMember(workspaceId: string, memberId: string) {
  publish(channels.workspace(workspaceId), {
    type: 'presence',
    payload: { member_id: memberId, presence: memberPresence(workspaceId, memberId) }
  })
}

function announceBusiness(workspaceId: string) {
  const state = businessPresence(workspaceId)
  publish(presenceChannel(workspaceId), {
    type: 'business.presence',
    payload: { online: state === 'online', state }
  })
}

export function agentJoined(workspaceId: string, memberId: string, peer: Peer) {
  const e = entry(workspaceId)
  let m = e.members.get(memberId)
  if (!m) {
    m = { peers: new Set(), away: false }
    e.members.set(memberId, m)
  }
  m.peers.add(peer)
  announceMember(workspaceId, memberId)
  announceBusiness(workspaceId)
}

export function agentSetAway(workspaceId: string, memberId: string, away: boolean) {
  const m = store.get(workspaceId)?.members.get(memberId)
  if (!m) return
  m.away = away
  announceMember(workspaceId, memberId)
  announceBusiness(workspaceId)
}

/** Remove a specific socket from a workspace (e.g. workspace switch). */
export function agentLeft(workspaceId: string, memberId: string, peer: Peer) {
  const e = store.get(workspaceId)
  const m = e?.members.get(memberId)
  if (!m) return
  m.peers.delete(peer)
  if (m.peers.size === 0) e!.members.delete(memberId)
  announceMember(workspaceId, memberId)
  announceBusiness(workspaceId)
}

/** Remove a socket from everywhere (disconnect). */
export function presencePeerGone(peer: Peer) {
  for (const [workspaceId, e] of store) {
    for (const [memberId, m] of e.members) {
      if (m.peers.delete(peer)) {
        if (m.peers.size === 0) e.members.delete(memberId)
        announceMember(workspaceId, memberId)
        announceBusiness(workspaceId)
      }
    }
  }
}
