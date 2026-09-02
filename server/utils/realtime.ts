import type { Peer } from 'crossws'
import type { WsEvent } from '@perch/shared'

/**
 * In-process real-time fan-out (§5.4). Everything that broadcasts goes through
 * `publish()`; connections register via `subscribe()`. v1 runs on a single
 * instance so an in-memory registry is enough. Horizontal scaling also requires
 * shared fan-out and authorization-revocation messages, not only shared events.
 *
 * Kept on `globalThis` so the WS handler and REST routes share one registry and
 * it survives dev HMR module reloads.
 */
interface Registry {
  channels: Map<string, Set<Peer>>
  peers: Set<Peer>
}

export interface AgentWorkspaceAuthorization {
  memberId: string
  memberRole: 'admin' | 'agent'
}

interface AgentRealtimeContext extends Record<string, unknown> {
  role?: unknown
  userId?: unknown
  sessionId?: unknown
  workspaceAuthorizations?: Map<string, AgentWorkspaceAuthorization>
  conversationWorkspaces?: Map<string, string>
}

const g = globalThis as unknown as { __perchRealtime?: Registry }
const registry: Registry = (g.__perchRealtime ??= { channels: new Map(), peers: new Set() })
registry.peers ??= new Set()

function agentContext(context: Record<string, unknown>): AgentRealtimeContext | null {
  return context.role === 'agent' ? context as AgentRealtimeContext : null
}

export function authorizeAgentWorkspace(
  context: Record<string, unknown>,
  workspaceId: string,
  authorization: AgentWorkspaceAuthorization
): void {
  const agent = agentContext(context)
  if (!agent) return
  if (!(agent.workspaceAuthorizations instanceof Map)) agent.workspaceAuthorizations = new Map()
  agent.workspaceAuthorizations.set(workspaceId, authorization)
}

export function authorizeAgentConversation(
  context: Record<string, unknown>,
  conversationId: string,
  workspaceId: string,
  authorization: AgentWorkspaceAuthorization
): void {
  const agent = agentContext(context)
  if (!agent) return
  authorizeAgentWorkspace(context, workspaceId, authorization)
  if (!(agent.conversationWorkspaces instanceof Map)) agent.conversationWorkspaces = new Map()
  agent.conversationWorkspaces.set(conversationId, workspaceId)
}

export function agentWorkspaceAuthorization(
  context: Record<string, unknown>,
  workspaceId: string
): AgentWorkspaceAuthorization | null {
  const agent = agentContext(context)
  if (!agent || !(agent.workspaceAuthorizations instanceof Map)) return null
  return agent.workspaceAuthorizations.get(workspaceId) ?? null
}

export function agentConversationWorkspace(
  context: Record<string, unknown>,
  conversationId: string
): string | null {
  const agent = agentContext(context)
  if (!agent || !(agent.conversationWorkspaces instanceof Map)) return null
  return agent.conversationWorkspaces.get(conversationId) ?? null
}

export function forgetAgentConversation(context: Record<string, unknown>, conversationId: string): void {
  const agent = agentContext(context)
  if (!agent || !(agent.conversationWorkspaces instanceof Map)) return
  agent.conversationWorkspaces.delete(conversationId)
}

export function forgetAgentWorkspace(context: Record<string, unknown>, workspaceId: string): void {
  const agent = agentContext(context)
  if (!agent) return
  if (agent.workspaceAuthorizations instanceof Map) agent.workspaceAuthorizations.delete(workspaceId)
  if (agent.conversationWorkspaces instanceof Map) {
    for (const [conversationId, ownerWorkspaceId] of agent.conversationWorkspaces) {
      if (ownerWorkspaceId === workspaceId) agent.conversationWorkspaces.delete(conversationId)
    }
  }
}

function registeredPeers(): Set<Peer> {
  const peers = new Set(registry.peers)
  for (const channelPeers of registry.channels.values()) {
    for (const peer of channelPeers) peers.add(peer)
  }
  return peers
}

function disconnectPeers(predicate: (context: Record<string, unknown>) => boolean, reason: string): number {
  let disconnected = 0
  for (const peer of registeredPeers()) {
    const context = peer.context as Record<string, unknown>
    if (!predicate(context)) continue
    unsubscribeAll(peer)
    registry.peers.delete(peer)
    disconnected++
    try {
      peer.close(1008, reason)
    } catch {
      // Already removed from fan-out; the transport may have closed first.
    }
  }
  return disconnected
}

/**
 * One socket may span workspaces, so an access change closes every socket for
 * that user and lets the client reconnect with fresh memberships and roles.
 */
export function disconnectWorkspaceUser(_workspaceId: string, userId: string): number {
  return disconnectPeers(
    context => context.role === 'agent' && context.userId === userId,
    'workspace access changed'
  )
}

/** Disconnect sockets created by sessions that have just been revoked. */
export function disconnectAgentSessions(sessionIds: string[]): number {
  if (!sessionIds.length) return 0
  const revoked = new Set(sessionIds)
  return disconnectPeers(
    context => context.role === 'agent' && typeof context.sessionId === 'string' && revoked.has(context.sessionId),
    'session revoked'
  )
}

export function subscribe(channel: string, peer: Peer): void {
  let set = registry.channels.get(channel)
  if (!set) {
    set = new Set()
    registry.channels.set(channel, set)
  }
  set.add(peer)
}

export function registerPeer(peer: Peer): void {
  registry.peers.add(peer)
}

export function unregisterPeer(peer: Peer): void {
  registry.peers.delete(peer)
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

export function isSubscribed(channel: string, peer: Peer): boolean {
  return registry.channels.get(channel)?.has(peer) ?? false
}

export function subscriptionCount(peer: Peer): number {
  let count = 0
  for (const set of registry.channels.values()) {
    if (set.has(peer)) count++
  }
  return count
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

/**
 * Like `publish`, but only to peers whose context passes `predicate`. Used to
 * scope inbox events so an agent never receives a conversation assigned to
 * someone else (agents see only the unassigned pool + their own chats).
 */
export function publishFiltered(
  channel: string,
  event: WsEvent,
  predicate: (context: Record<string, unknown>) => boolean
): void {
  const set = registry.channels.get(channel)
  if (!set || set.size === 0) return
  const data = JSON.stringify(event)
  for (const peer of set) {
    if (!predicate(peer.context as Record<string, unknown>)) continue
    try {
      peer.send(data)
    } catch {
      // peer gone
    }
  }
}

/** Fan out a conversation event using the current assignee at send time. */
export function publishConversationEvent(
  workspaceId: string,
  conversationId: string,
  event: WsEvent,
  assignedAgentId: string | null,
  collaboratorMemberIds: string[] = [],
  opts?: { agentsOnly?: boolean }
): void {
  publishFiltered(`conversation:${conversationId}`, event, (context) => {
    if (context.role === 'visitor') return context.wid === workspaceId && !opts?.agentsOnly
    if (context.role !== 'agent') return false
    const authorization = agentWorkspaceAuthorization(context, workspaceId)
    if (!authorization || agentConversationWorkspace(context, conversationId) !== workspaceId) return false
    return authorization.memberRole === 'admin'
      || assignedAgentId === null
      || authorization.memberId === assignedAgentId
      || collaboratorMemberIds.includes(authorization.memberId)
  })
}

/** Number of peers on a channel — used for `business.presence` (any agent online?). */
export function subscriberCount(channel: string): number {
  return registry.channels.get(channel)?.size ?? 0
}
