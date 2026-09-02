import { readFileSync } from 'node:fs'
import { channels } from '@perch/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { inboxScope } from '../server/utils/conversations'
import {
  authorizeAgentConversation,
  authorizeAgentWorkspace,
  disconnectAgentSessions,
  disconnectWorkspaceUser,
  publish,
  publishConversationEvent,
  publishFiltered,
  registerPeer,
  subscribe,
  unsubscribeAll,
  unregisterPeer
} from '../server/utils/realtime'

interface FakePeer {
  context: Record<string, unknown>
  sent: string[]
  closed: Array<{ code?: number, reason?: string }>
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

const peers: FakePeer[] = []

function fakePeer(context: Record<string, unknown>): FakePeer {
  const peer: FakePeer = {
    context,
    sent: [],
    closed: [],
    send(data) {
      this.sent.push(data)
    },
    close(code, reason) {
      this.closed.push({ code, reason })
    }
  }
  peers.push(peer)
  registerPeer(asPeer(peer))
  return peer
}

function asPeer(peer: FakePeer) {
  return peer as never
}

function agentContext(userId: string, sessionId: string) {
  return { role: 'agent', userId, sessionId }
}

afterEach(() => {
  for (const peer of peers.splice(0)) {
    unsubscribeAll(asPeer(peer))
    unregisterPeer(asPeer(peer))
  }
})

describe('workspace-scoped realtime authorization', () => {
  const workspaceA = 'workspace-a'
  const workspaceB = 'workspace-b'
  const conversationA = 'conversation-a'
  const conversationB = 'conversation-b'

  it.each([
    ['A then B', [workspaceA, workspaceB]],
    ['B then A', [workspaceB, workspaceA]]
  ] as const)('does not let an admin role bleed across workspaces: %s', (_label, order) => {
    const context = agentContext('user-1', 'session-1')
    for (const workspaceId of order) {
      authorizeAgentConversation(
        context,
        workspaceId === workspaceA ? conversationA : conversationB,
        workspaceId,
        workspaceId === workspaceA
          ? { memberId: 'agent-a', memberRole: 'agent' }
          : { memberId: 'admin-b', memberRole: 'admin' }
      )
    }

    expect(inboxScope(workspaceA, 'another-agent')(context)).toBe(false)
    expect(inboxScope(workspaceB, 'another-agent')(context)).toBe(true)
  })

  it('keeps internal notes private from an agent who is admin only elsewhere', () => {
    const context = agentContext('user-1', 'session-1')
    authorizeAgentConversation(context, conversationA, workspaceA, {
      memberId: 'agent-a', memberRole: 'agent'
    })
    authorizeAgentWorkspace(context, workspaceB, { memberId: 'admin-b', memberRole: 'admin' })
    const peer = fakePeer(context)
    subscribe(channels.workspace(workspaceA), asPeer(peer))
    subscribe(channels.conversation(conversationA), asPeer(peer))
    const note = {
      type: 'message.new' as const,
      payload: {
        id: 'message-1',
        conversation_id: conversationA,
        sender_type: 'agent' as const,
        sender_id: 'owner-a',
        content: 'private note',
        attachment_url: null,
        attachment_type: null,
        is_internal_note: true,
        mentioned_member_ids: [],
        created_at: new Date(0).toISOString()
      }
    }

    publishFiltered(channels.workspace(workspaceA), note, inboxScope(workspaceA, 'owner-a'))
    publishConversationEvent(workspaceA, conversationA, note, 'owner-a', [], { agentsOnly: true })

    expect(peer.sent).toEqual([])
  })

  it('preserves ordinary same-workspace inbox and conversation delivery', () => {
    const context = agentContext('user-1', 'session-1')
    authorizeAgentConversation(context, conversationA, workspaceA, {
      memberId: 'agent-a', memberRole: 'agent'
    })
    const peer = fakePeer(context)
    subscribe(channels.workspace(workspaceA), asPeer(peer))
    subscribe(channels.conversation(conversationA), asPeer(peer))
    const event = { type: 'conversation.refresh' as const, payload: { conversation_id: conversationA } }

    publishFiltered(channels.workspace(workspaceA), event, inboxScope(workspaceA, 'agent-a'))
    publishConversationEvent(workspaceA, conversationA, event, 'agent-a', [], { agentsOnly: true })

    expect(peer.sent).toHaveLength(2)
  })
})

describe('live authorization invalidation', () => {
  it.each(['role downgrade', 'member removal'])('stops delivery immediately after %s', () => {
    const context = agentContext('user-1', 'session-1')
    authorizeAgentWorkspace(context, 'workspace-a', { memberId: 'member-a', memberRole: 'admin' })
    const peer = fakePeer(context)
    subscribe(channels.workspace('workspace-a'), asPeer(peer))

    expect(disconnectWorkspaceUser('workspace-a', 'user-1')).toBe(1)
    publish(channels.workspace('workspace-a'), { type: 'conversation.refresh', payload: { conversation_id: 'conversation-a' } })

    expect(peer.closed).toEqual([{ code: 1008, reason: 'workspace access changed' }])
    expect(peer.sent).toEqual([])
  })

  it('stops delivery immediately when the socket session is revoked', () => {
    const context = agentContext('user-1', 'session-1')
    authorizeAgentWorkspace(context, 'workspace-a', { memberId: 'member-a', memberRole: 'agent' })
    const peer = fakePeer(context)

    expect(disconnectAgentSessions(['session-1'])).toBe(1)
    publish(channels.workspace('workspace-a'), { type: 'conversation.refresh', payload: { conversation_id: 'conversation-a' } })

    expect(peer.closed).toEqual([{ code: 1008, reason: 'session revoked' }])
    expect(peer.sent).toEqual([])
  })

  it('hooks role changes, removals, and session revocation into the registry invalidators', () => {
    const roleRoute = readFileSync(
      new URL('../server/api/workspaces/[id]/members/[memberId].patch.ts', import.meta.url),
      'utf8'
    )
    const removalRoute = readFileSync(
      new URL('../server/api/workspaces/[id]/members/[memberId].delete.ts', import.meta.url),
      'utf8'
    )
    const sessions = readFileSync(new URL('../server/utils/db-sessions.ts', import.meta.url), 'utf8')
    const ticketRoute = readFileSync(new URL('../server/api/realtime/ticket.get.ts', import.meta.url), 'utf8')
    const websocket = readFileSync(new URL('../server/routes/api/ws.ts', import.meta.url), 'utf8')

    expect(roleRoute).toContain('disconnectWorkspaceUser(workspaceId, target.userId)')
    expect(removalRoute).toContain('disconnectWorkspaceUser(workspaceId, target.userId)')
    expect(sessions).toContain('disconnectAgentSessions(ids)')
    expect(ticketRoute).toContain('sid: sessionId')
    expect(websocket).toContain('isSessionAliveForRealtime(subject.sid, subject.uid)')
  })
})
