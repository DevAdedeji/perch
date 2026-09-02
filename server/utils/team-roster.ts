import type { Role } from '@perch/shared'

export type TeamPresence = 'online' | 'away' | 'offline'

export interface TeamRosterRecord {
  id: string
  name: string
  role: Role
}

export interface AdminTeamRosterRecord extends TeamRosterRecord {
  userId: string
  email: string
  openCount: number | string
  resolvedCount: number | string
  csatGood: number | string
  csatBad: number | string
}

export function teamRosterMemberDto(member: TeamRosterRecord, presence: TeamPresence) {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    presence
  }
}

export function adminTeamRosterMemberDto(member: AdminTeamRosterRecord, presence: TeamPresence) {
  return {
    ...teamRosterMemberDto(member, presence),
    userId: member.userId,
    email: member.email,
    openCount: Number(member.openCount),
    resolvedCount: Number(member.resolvedCount),
    csatGood: Number(member.csatGood),
    csatBad: Number(member.csatBad)
  }
}
