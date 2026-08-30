import { describe, expect, it } from 'vitest'
import { inboxRemovalScope, inboxScope } from '../server/utils/conversations'
import { canMemberAccessConversation } from '../server/utils/workspace'

describe('inboxScope — agent visibility on the workspace channel', () => {
  const admin = { memberRole: 'admin', memberId: 'admin-1' }
  const agentA = { memberRole: 'agent', memberId: 'agent-a' }
  const agentB = { memberRole: 'agent', memberId: 'agent-b' }

  it('admins receive everything', () => {
    expect(inboxScope(null)(admin)).toBe(true)
    expect(inboxScope('agent-a')(admin)).toBe(true)
    expect(inboxScope('agent-b')(admin)).toBe(true)
  })

  it('agents receive the unassigned pool', () => {
    expect(inboxScope(null)(agentA)).toBe(true)
    expect(inboxScope(null)(agentB)).toBe(true)
  })

  it('agents receive their own conversations but not other agents\'', () => {
    expect(inboxScope('agent-a')(agentA)).toBe(true)
    expect(inboxScope('agent-a')(agentB)).toBe(false)
    expect(inboxScope('agent-b')(agentA)).toBe(false)
  })

  it('a peer with no membership context receives nothing assigned', () => {
    expect(inboxScope('agent-a')({})).toBe(false)
  })
})

describe('inboxRemovalScope — assignment visibility changes', () => {
  const admin = { role: 'agent', memberRole: 'admin', memberId: 'admin-1' }
  const agentA = { role: 'agent', memberRole: 'agent', memberId: 'agent-a' }
  const agentB = { role: 'agent', memberRole: 'agent', memberId: 'agent-b' }
  const visitor = { role: 'visitor' }

  it('removes a newly claimed pool conversation from other agents only', () => {
    const scope = inboxRemovalScope(null, 'agent-a')
    expect(scope(agentA)).toBe(false)
    expect(scope(agentB)).toBe(true)
    expect(scope(admin)).toBe(false)
    expect(scope(visitor)).toBe(false)
  })

  it('removes a reassigned conversation from its previous owner', () => {
    const scope = inboxRemovalScope('agent-a', 'agent-b')
    expect(scope(agentA)).toBe(true)
    expect(scope(agentB)).toBe(false)
  })
})

describe('conversation authorization', () => {
  const member = (id: string, role: 'admin' | 'agent') => ({ id, role }) as Parameters<typeof canMemberAccessConversation>[0]
  const conversation = (assignedAgentId: string | null) => ({ assignedAgentId }) as Parameters<typeof canMemberAccessConversation>[1]

  it('matches inbox visibility for direct REST and WS access', () => {
    expect(canMemberAccessConversation(member('admin', 'admin'), conversation('someone-else'))).toBe(true)
    expect(canMemberAccessConversation(member('agent-a', 'agent'), conversation(null))).toBe(true)
    expect(canMemberAccessConversation(member('agent-a', 'agent'), conversation('agent-a'))).toBe(true)
    expect(canMemberAccessConversation(member('agent-a', 'agent'), conversation('agent-b'))).toBe(false)
  })
})
