import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { adminTeamRosterMemberDto, teamRosterMemberDto } from '../server/utils/team-roster'

const fullMember = {
  id: 'member-1',
  userId: 'user-1',
  name: 'Ari Agent',
  email: 'ari@example.test',
  role: 'agent' as const,
  openCount: '4',
  resolvedCount: 12,
  csatGood: '9',
  csatBad: 1
}

describe('team roster response privacy', () => {
  it('returns only collaboration-safe fields in an agent roster record', () => {
    const record = teamRosterMemberDto(fullMember, 'online')

    expect(record).toEqual({
      id: 'member-1',
      name: 'Ari Agent',
      role: 'agent',
      presence: 'online'
    })
    expect(record).not.toHaveProperty('userId')
    expect(record).not.toHaveProperty('email')
    expect(record).not.toHaveProperty('openCount')
    expect(record).not.toHaveProperty('resolvedCount')
    expect(record).not.toHaveProperty('csatGood')
    expect(record).not.toHaveProperty('csatBad')
  })

  it('preserves admin management fields and normalizes database counts', () => {
    expect(adminTeamRosterMemberDto(fullMember, 'away')).toEqual({
      id: 'member-1',
      userId: 'user-1',
      name: 'Ari Agent',
      email: 'ari@example.test',
      role: 'agent',
      presence: 'away',
      openCount: 4,
      resolvedCount: 12,
      csatGood: 9,
      csatBad: 1
    })
  })
})

describe('team roster authorization boundary', () => {
  const route = readFileSync(new URL('../server/api/workspaces/[id]/members.get.ts', import.meta.url), 'utf8')

  it('authorizes workspace membership and branches on the viewer role before selecting private data', () => {
    const roleBoundary = route.indexOf('if (viewer.role !== \'admin\')')
    const privateSelection = route.indexOf('email: users.email')

    expect(route).toContain('const { member: viewer } = await requireMembership(event, workspaceId)')
    expect(roleBoundary).toBeGreaterThan(-1)
    expect(privateSelection).toBeGreaterThan(roleBoundary)
    expect(route.slice(roleBoundary, privateSelection)).toContain('return rows.map(member => teamRosterMemberDto(')
    expect(route).toContain('return rows.map(member => adminTeamRosterMemberDto(')
  })
})

describe('team roster consumers', () => {
  const teamPage = readFileSync(new URL('../app/pages/team.vue', import.meta.url), 'utf8')
  const controlRoom = readFileSync(new URL('../app/composables/useControlRoom.ts', import.meta.url), 'utf8')
  const nestPage = readFileSync(new URL('../app/pages/nest.vue', import.meta.url), 'utf8')

  it('shows agents a useful roster without private admin columns', () => {
    const adminOnlyOpenSummary = teamPage.slice(
      teamPage.indexOf('v-if="isAdmin"', teamPage.indexOf('Online now')),
      teamPage.indexOf('<!-- roster -->')
    )

    expect(teamPage).toContain('v-if="isAdmin && m.email"')
    expect(teamPage).toContain(':class="isAdmin ? \'grid-cols-3\' : \'grid-cols-2\'"')
    expect(teamPage).toContain('v-if="isAdmin"\n                    class="px-3 py-2.5 text-center font-medium"')
    expect(adminOnlyOpenSummary).toContain('Open conversations')
    expect(teamPage).toContain('member.id === currentWorkspace.value?.memberId')
    expect(teamPage).not.toContain('m.userId')
  })

  it('keeps the shared assignment and mention roster limited to collaboration-safe fields', () => {
    const memberInterface = controlRoom.slice(
      controlRoom.indexOf('export interface TeamMember'),
      controlRoom.indexOf('export interface CannedResponse')
    )

    expect(memberInterface).toContain('id: string')
    expect(memberInterface).toContain('name: string')
    expect(memberInterface).toContain('role: \'admin\' | \'agent\'')
    expect(memberInterface).toContain('presence: \'online\' | \'offline\' | \'away\'')
    expect(memberInterface).not.toContain('email')
    expect(memberInterface).not.toContain('userId')
    expect(nestPage).toContain('`/api/workspaces/${wid.value}/members`')
  })
})
