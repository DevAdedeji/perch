import { and, eq, sql, workspaceMembers, type Database } from '@perch/db'

export type MutationTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export async function lockWorkspaceMembership(tx: MutationTransaction, workspaceId: string): Promise<void> {
  // Membership removals/role changes use this same lock. Take it before
  // conversation locks so an authorization decision stays valid until commit.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`)
}

export async function currentMutationMember(tx: MutationTransaction, workspaceId: string, memberId: string) {
  const member = await tx.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.id, memberId))
  })
  if (!member) throw createError({ statusCode: 403, statusMessage: 'You are no longer a member of this workspace' })
  return member
}
