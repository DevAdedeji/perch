import { describe, expect, it } from 'vitest'
import { inboxRemovalScope, inboxScope } from '../server/utils/conversations'
import { authorizeAgentWorkspace } from '../server/utils/realtime'
import { canMemberAccessConversation, canMemberReassignConversation } from '../server/utils/workspace'

describe('inboxScope — agent visibility on the workspace channel', () => {
  const workspaceId = 'workspace-a'
  const context = (memberId: string, memberRole: 'admin' | 'agent') => {
    const value = { role: 'agent' }
    authorizeAgentWorkspace(value, workspaceId, { memberId, memberRole })
    return value
  }
  const admin = context('admin-1', 'admin')
  const agentA = context('agent-a', 'agent')
  const agentB = context('agent-b', 'agent')

  it('admins receive everything', () => {
    expect(inboxScope(workspaceId, null)(admin)).toBe(true)
    expect(inboxScope(workspaceId, 'agent-a')(admin)).toBe(true)
    expect(inboxScope(workspaceId, 'agent-b')(admin)).toBe(true)
  })

  it('agents receive the unassigned pool', () => {
    expect(inboxScope(workspaceId, null)(agentA)).toBe(true)
    expect(inboxScope(workspaceId, null)(agentB)).toBe(true)
  })

  it('agents receive their own conversations but not other agents\'', () => {
    expect(inboxScope(workspaceId, 'agent-a')(agentA)).toBe(true)
    expect(inboxScope(workspaceId, 'agent-a')(agentB)).toBe(false)
    expect(inboxScope(workspaceId, 'agent-b')(agentA)).toBe(false)
  })

  it('collaborators receive only the conversations where they were mentioned', () => {
    expect(inboxScope(workspaceId, 'agent-a', ['agent-b'])(agentB)).toBe(true)
    expect(inboxScope(workspaceId, 'agent-a', ['agent-c'])(agentB)).toBe(false)
  })

  it('a peer with no membership context receives nothing assigned', () => {
    expect(inboxScope(workspaceId, 'agent-a')({})).toBe(false)
  })
})

describe('inboxRemovalScope — assignment visibility changes', () => {
  const workspaceId = 'workspace-a'
  const context = (memberId: string, memberRole: 'admin' | 'agent') => {
    const value = { role: 'agent' }
    authorizeAgentWorkspace(value, workspaceId, { memberId, memberRole })
    return value
  }
  const admin = context('admin-1', 'admin')
  const agentA = context('agent-a', 'agent')
  const agentB = context('agent-b', 'agent')
  const visitor = { role: 'visitor' }

  it('removes a newly claimed pool conversation from other agents only', () => {
    const scope = inboxRemovalScope(workspaceId, null, 'agent-a')
    expect(scope(agentA)).toBe(false)
    expect(scope(agentB)).toBe(true)
    expect(scope(admin)).toBe(false)
    expect(scope(visitor)).toBe(false)
  })

  it('removes a reassigned conversation from its previous owner', () => {
    const scope = inboxRemovalScope(workspaceId, 'agent-a', 'agent-b')
    expect(scope(agentA)).toBe(true)
    expect(scope(agentB)).toBe(false)
  })

  it('keeps a previous owner who is also a collaborator', () => {
    const scope = inboxRemovalScope(workspaceId, 'agent-a', 'agent-b', ['agent-a'])
    expect(scope(agentA)).toBe(false)
  })
})

describe('conversation authorization', () => {
  const member = (id: string, role: 'admin' | 'agent') => ({ id, role }) as Parameters<typeof canMemberAccessConversation>[0]
  const conversation = (assignedAgentId: string | null, collaboratorMemberIds: string[] = []) => ({
    assignedAgentId,
    collaboratorMemberIds
  }) as Parameters<typeof canMemberAccessConversation>[1]

  it('matches inbox visibility for direct REST and WS access', () => {
    expect(canMemberAccessConversation(member('admin', 'admin'), conversation('someone-else'))).toBe(true)
    expect(canMemberAccessConversation(member('agent-a', 'agent'), conversation(null))).toBe(true)
    expect(canMemberAccessConversation(member('agent-a', 'agent'), conversation('agent-a'))).toBe(true)
    expect(canMemberAccessConversation(member('agent-a', 'agent'), conversation('agent-b', ['agent-a']))).toBe(true)
    expect(canMemberAccessConversation(member('agent-a', 'agent'), conversation('agent-b'))).toBe(false)
  })

  it('allows only admins and the current assignee to transfer ownership', () => {
    expect(canMemberReassignConversation(member('admin', 'admin'), conversation('agent-a'))).toBe(true)
    expect(canMemberReassignConversation(member('agent-a', 'agent'), conversation('agent-a'))).toBe(true)
    expect(canMemberReassignConversation(member('agent-b', 'agent'), conversation('agent-a', ['agent-b']))).toBe(false)
  })
})
