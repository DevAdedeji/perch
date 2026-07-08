import { and, conversations, eq, workspaceMembers } from '@perch/db'
import type { WorkspaceMember } from '@perch/db'
import { channels } from '@perch/shared'

/**
 * The Control Room WebSocket (§6). Agents connect with an agent ticket and may
 * subscribe to their workspaces + any conversation in them. A visitor connects
 * with a visitor ticket scoped to one workspace+visitor and may ONLY subscribe
 * to its own conversations (and the workspace's `presence:` channel).
 *
 * Mutations happen over REST and fan out via `publish()`; this handler owns the
 * connection lifecycle, authorized subscription, presence, and typing relay.
 */

async function getMember(userId: string, workspaceId: string): Promise<WorkspaceMember | undefined> {
  const db = useDb()
  return db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId))
  })
}

async function agentCanAccessConversation(userId: string, conversationId: string): Promise<boolean> {
  const db = useDb()
  const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  if (!convo) return false
  return !!(await getMember(userId, convo.workspaceId))
}

async function visitorCanAccessConversation(wid: string, vid: string, conversationId: string): Promise<boolean> {
  const db = useDb()
  const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  return !!convo && convo.workspaceId === wid && convo.visitorRef === vid
}

async function handleSubscribe(peer: import('crossws').Peer, channel: unknown) {
  if (typeof channel !== 'string') return
  const [kind, id] = channel.split(':')
  if (!id) return

  const ctx = peer.context
  let allowed = false

  if (ctx.role === 'agent') {
    if (kind === 'workspace') {
      const member = await getMember(ctx.userId as string, id)
      if (member) {
        ctx.memberId = member.id
        ctx.memberRole = member.role
        ctx.wid = id
        subscribe(channel, peer)
        peer.send(JSON.stringify({ type: 'subscribed', channel }))
        agentJoined(id, member.id, peer)
        return
      }
    } else if (kind === 'conversation') {
      allowed = await agentCanAccessConversation(ctx.userId as string, id)
    }
  } else if (ctx.role === 'visitor') {
    if (kind === 'conversation') allowed = await visitorCanAccessConversation(ctx.wid as string, ctx.vid as string, id)
    else if (kind === 'presence') allowed = id === ctx.wid
  }

  if (!allowed) {
    peer.send(JSON.stringify({ type: 'subscribe.error', channel }))
    return
  }
  subscribe(channel, peer)
  peer.send(JSON.stringify({ type: 'subscribed', channel }))
}

export default defineWebSocketHandler({
  open(peer) {
    const url = new URL(peer.request?.url ?? '/', 'http://localhost')
    const ticket = url.searchParams.get('ticket')
    const secret = useRuntimeConfig().realtimeSecret || process.env.NUXT_SESSION_PASSWORD
    const subject = ticket && secret ? verifyTicket(ticket, secret) : null

    if (!subject) {
      peer.close(1008, 'unauthorized')
      return
    }
    if (subject.role === 'agent') {
      peer.context.role = 'agent'
      peer.context.userId = subject.uid
    } else {
      peer.context.role = 'visitor'
      peer.context.wid = subject.wid
      peer.context.vid = subject.vid
    }
    peer.send(JSON.stringify({ type: 'connected' }))
  },

  async message(peer, message) {
    const ctx = peer.context
    if (!ctx.role) {
      peer.close(1008, 'unauthorized')
      return
    }

    let msg: { type?: string, channel?: unknown, payload?: { conversation_id?: string, presence?: string } }
    try {
      msg = JSON.parse(message.text())
    } catch {
      return
    }

    switch (msg.type) {
      case 'subscribe':
        await handleSubscribe(peer, msg.channel)
        break
      case 'unsubscribe': {
        if (typeof msg.channel !== 'string') break
        unsubscribe(msg.channel, peer)
        // leaving a workspace channel = going offline there
        if (ctx.role === 'agent' && ctx.memberId && msg.channel === channels.workspace(ctx.wid as string)) {
          agentLeft(ctx.wid as string, ctx.memberId as string, peer)
        }
        break
      }
      case 'presence.update':
        if (ctx.role === 'agent' && ctx.memberId && ctx.wid) {
          agentSetAway(ctx.wid as string, ctx.memberId as string, msg.payload?.presence === 'away')
        }
        break
      case 'typing.start':
      case 'typing.stop': {
        const conversationId = msg.payload?.conversation_id
        if (!conversationId) break
        publish(channels.conversation(conversationId), {
          type: 'typing',
          payload: {
            conversation_id: conversationId,
            actor: ctx.role === 'visitor' ? 'visitor' : 'agent',
            is_typing: msg.type === 'typing.start'
          }
        })
        break
      }
    }
  },

  close(peer) {
    presencePeerGone(peer)
    unsubscribeAll(peer)
  },

  error(peer) {
    presencePeerGone(peer)
    unsubscribeAll(peer)
  }
})
