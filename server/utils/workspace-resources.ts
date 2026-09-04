import { and, auditLogs, count, eq, tags, triggers, workspaces, type Database } from '@perch/db'
import type { SessionUser } from './require-user'

export async function createWorkspaceTag(db: Database, workspaceId: string, name: string) {
  return db.transaction(async (tx) => {
    const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.id, workspaceId)).for('update')
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
    const existing = await tx.query.tags.findFirst({ where: and(eq(tags.workspaceId, workspaceId), eq(tags.name, name)) })
    if (existing) return { tag: existing, created: false }
    const [aggregate] = await tx.select({ total: count() }).from(tags).where(eq(tags.workspaceId, workspaceId))
    if (Number(aggregate?.total ?? 0) >= 50) {
      throw createError({ statusCode: 400, statusMessage: 'A workspace can have at most 50 tags' })
    }
    const [tag] = await tx.insert(tags).values({ workspaceId, name }).returning()
    return { tag: tag!, created: true }
  })
}

export async function createWorkspaceTrigger(db: Database, input: {
  workspaceId: string
  name: string
  urlMatch: string
  dwellSeconds: number
  message: string
}, actor: SessionUser) {
  return db.transaction(async (tx) => {
    const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.id, input.workspaceId)).for('update')
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
    const [aggregate] = await tx.select({ total: count() }).from(triggers).where(eq(triggers.workspaceId, input.workspaceId))
    if (Number(aggregate?.total ?? 0) >= 20) {
      throw createError({ statusCode: 400, statusMessage: 'A workspace can have at most 20 triggers' })
    }
    const [rule] = await tx.insert(triggers).values(input).returning()
    await tx.insert(auditLogs).values({ workspaceId: input.workspaceId, actorId: actor.id, actorName: actor.name, action: 'trigger.created', detail: { name: input.name } })
    return rule!
  })
}
