import { and, conversations, eq, visitors, workspaceMembers } from '@perch/db'
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

async function agentConversationMembership(userId: string, conversationId: string): Promise<WorkspaceMember | undefined> {
  const db = useDb()
  const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  if (!convo) return undefined
  const member = await getMember(userId, convo.workspaceId)
  return member && canMemberAccessConversation(member, convo) ? member : undefined
}

async function visitorCanAccessConversation(wid: string, vid: string, conversationId: string): Promise<boolean> {
  const db = useDb()
  const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  return !!convo && convo.workspaceId === wid && convo.visitorRef === vid
}

async function handleSubscribe(peer: import('crossws').Peer, channel: unknown) {
  if (typeof channel !== 'string') return
  const parts = channel.split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1] || channel.length > 128) return
  const [kind, id] = parts

  if (!isSubscribed(channel, peer) && subscriptionCount(peer) >= 8) {
    peer.send(JSON.stringify({ type: 'subscribe.error', channel, reason: 'channel limit reached' }))
    return
  }

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
      const member = await agentConversationMembership(ctx.userId as string, id)
      allowed = !!member
      if (member) {
        ctx.memberId = member.id
        ctx.memberRole = member.role
      }
    } else if (kind === 'visitors') {
      // live-roster deltas — any member of the workspace may watch
      allowed = !!(await getMember(ctx.userId as string, id))
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
    const secret = realtimeSecret()
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
      peer.context.hostOrigin = subject.hostOrigin
      peer.context.installationPreview = subject.installationPreview === true
      // register on the roster SYNCHRONOUSLY — the widget's first
      // `visitor.page` can arrive before an awaited DB fetch resolves, and it
      // must not find an unregistered visitor. wid/vid come from the signed
      // ticket, so registration needs no lookup; the identity snapshot
      // backfills async (and re-announces as an upsert).
      visitorConnected(subject.wid, subject.vid, peer, { name: null, email: null, verified: false })
      useDb().query.visitors.findFirst({ where: eq(visitors.id, subject.vid) })
        .then((visitor) => {
          if (visitor && visitor.workspaceId === subject.wid && (visitor.name || visitor.email || visitor.identityVerified)) {
            visitorIdentified(subject.wid, subject.vid, {
              name: visitor.name,
              email: visitor.email,
              verified: visitor.identityVerified
            })
          }
        })
        .catch(() => {})
    }
    peer.send(JSON.stringify({ type: 'connected' }))
  },

  async message(peer, message) {
    const ctx = peer.context
    if (!ctx.role) {
      peer.close(1008, 'unauthorized')
      return
    }

    const raw = message.text()
    if (raw.length > 8192) {
      peer.close(1009, 'message too large')
      return
    }

    const now = Date.now()
    const windowStart = typeof ctx.rateWindowStart === 'number' ? ctx.rateWindowStart : now
    const count = typeof ctx.rateEventCount === 'number' ? ctx.rateEventCount : 0
    if (now - windowStart >= 60_000) {
      ctx.rateWindowStart = now
      ctx.rateEventCount = 1
    } else {
      ctx.rateWindowStart = windowStart
      const nextCount = count + 1
      ctx.rateEventCount = nextCount
      if (nextCount > 240) {
        peer.close(1008, 'rate limit exceeded')
        return
      }
    }

    let msg: { type?: string, channel?: unknown, payload?: { conversation_id?: string, presence?: string } }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    switch (msg.type) {
      case 'ping':
        // client heartbeat — lets both ends notice dead sockets in seconds
        peer.send('{"type":"pong"}')
        break
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
      case 'visitor.page': {
        // the widget reporting the host page it's on (roster + trigger dwell)
        const pageUrl = (msg.payload as { page_url?: unknown } | undefined)?.page_url
        if (ctx.role === 'visitor' && typeof pageUrl === 'string' && pageUrl) {
          const page = installationPageForOrigin(pageUrl, ctx.hostOrigin)
          if (page) {
            visitorPageUpdate(ctx.wid as string, ctx.vid as string, page.url)
            if (!ctx.installationPreview) {
              const installationSignalAllowed = consumeRateLimit(
                'installation-signal:visitor',
                `${ctx.wid as string}:${ctx.vid as string}`,
                { max: 12, windowMs: 60_000 }
              ) && consumeRateLimit(
                'installation-signal:workspace',
                ctx.wid as string,
                { max: 120, windowMs: 60_000 }
              )
              if (installationSignalAllowed) {
                await recordWidgetInstallation(ctx.wid as string, page.url, ctx.hostOrigin)
              }
            }
          }
        }
        break
      }
      case 'typing.start':
      case 'typing.stop': {
        const conversationId = msg.payload?.conversation_id
        if (!conversationId || conversationId.length > 64) break
        const channel = channels.conversation(conversationId)
        if (!isSubscribed(channel, peer)) break
        const convo = await useDb().query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
        if (!convo) break
        const currentMember = ctx.role === 'agent' ? await getMember(ctx.userId as string, convo.workspaceId) : undefined
        const stillAllowed = ctx.role === 'agent'
          ? !!currentMember && canMemberAccessConversation(currentMember, convo)
          : convo.workspaceId === ctx.wid && convo.visitorRef === ctx.vid
        if (!stillAllowed) {
          unsubscribe(channel, peer)
          break
        }
        // sneak-peek: relay the visitor's draft to agents — WS-only, never stored.
        // strictly one-directional: an agent's draft must never reach the visitor.
        const rawPreview = (msg.payload as { preview?: unknown } | undefined)?.preview
        const preview = ctx.role === 'visitor' && msg.type === 'typing.start' && typeof rawPreview === 'string'
          ? rawPreview.slice(0, 500)
          : null
        publishConversationEvent(channel, {
          type: 'typing',
          payload: {
            conversation_id: conversationId,
            actor: ctx.role === 'visitor' ? 'visitor' : 'agent',
            is_typing: msg.type === 'typing.start',
            preview
          }
        }, convo.assignedAgentId)
        break
      }
    }
  },

  close(peer) {
    presencePeerGone(peer)
    visitorPeerGone(peer)
    unsubscribeAll(peer)
  },

  error(peer) {
    presencePeerGone(peer)
    visitorPeerGone(peer)
    unsubscribeAll(peer)
  }
})
