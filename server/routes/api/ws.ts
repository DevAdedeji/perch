import { and, conversations, eq, workspaceMembers } from '@perch/db'
import { channels } from '@perch/shared'

/**
 * The Control Room WebSocket (§6). Agents connect with a signed ticket, then
 * subscribe to the channels they're authorized for. A visitor's socket (later)
 * will only ever be allowed on its own `conversation:{id}`.
 *
 * Mutations happen over REST and fan out via `publish()`; this handler owns the
 * connection lifecycle, authorized subscription, and ephemeral typing relay.
 */

async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const db = useDb()
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId))
  })
  return !!member
}

async function canAccessConversation(userId: string, conversationId: string): Promise<boolean> {
  const db = useDb()
  const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  if (!convo) return false
  return isWorkspaceMember(userId, convo.workspaceId)
}

async function handleSubscribe(peer: import('crossws').Peer, userId: string, channel: unknown) {
  if (typeof channel !== 'string') return
  const [kind, id] = channel.split(':')
  if (!id) return

  let allowed = false
  if (kind === 'workspace') allowed = await isWorkspaceMember(userId, id)
  else if (kind === 'conversation') allowed = await canAccessConversation(userId, id)

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
    const secret = useRuntimeConfig().realtimeSecret
    const verified = ticket && secret ? verifyTicket(ticket, secret) : null

    if (!verified) {
      peer.close(1008, 'unauthorized')
      return
    }
    peer.context.userId = verified.uid
    peer.context.role = 'agent'
    peer.send(JSON.stringify({ type: 'connected' }))
  },

  async message(peer, message) {
    const userId = peer.context.userId as string | undefined
    if (!userId) {
      peer.close(1008, 'unauthorized')
      return
    }

    let msg: { type?: string, channel?: unknown, payload?: { conversation_id?: string } }
    try {
      msg = JSON.parse(message.text())
    } catch {
      return
    }

    switch (msg.type) {
      case 'subscribe':
        await handleSubscribe(peer, userId, msg.channel)
        break
      case 'unsubscribe':
        if (typeof msg.channel === 'string') unsubscribe(msg.channel, peer)
        break
      case 'typing.start':
      case 'typing.stop': {
        const conversationId = msg.payload?.conversation_id
        if (!conversationId) break
        publish(channels.conversation(conversationId), {
          type: 'typing',
          payload: { conversation_id: conversationId, actor: 'agent', is_typing: msg.type === 'typing.start' }
        })
        break
      }
    }
  },

  close(peer) {
    unsubscribeAll(peer)
  },

  error(peer) {
    unsubscribeAll(peer)
  }
})
