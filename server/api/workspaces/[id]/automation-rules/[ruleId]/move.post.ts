import { and, asc, automationRules, eq, workspaces } from '@perch/db'
import { z } from 'zod'

const schema = z.object({ direction: z.enum(['up', 'down']) }).strict()

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const ruleId = getRouterParam(event, 'ruleId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Invalid direction' })

  const outcome = await useDb().transaction(async (tx) => {
    const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.id, workspaceId)).for('update')
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })
    const rules = await tx.select().from(automationRules)
      .where(eq(automationRules.workspaceId, workspaceId))
      .orderBy(asc(automationRules.sortOrder), asc(automationRules.createdAt), asc(automationRules.id))
      .for('update')
    const index = rules.findIndex(rule => rule.id === ruleId)
    if (index < 0) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })
    const otherIndex = result.data.direction === 'up' ? index - 1 : index + 1
    const other = rules[otherIndex]
    if (!other) return { moved: false, rules }

    const current = rules[index]!
    await tx.update(automationRules).set({ sortOrder: other.sortOrder, updatedAt: new Date() }).where(and(
      eq(automationRules.id, current.id), eq(automationRules.workspaceId, workspaceId)
    ))
    await tx.update(automationRules).set({ sortOrder: current.sortOrder, updatedAt: new Date() }).where(and(
      eq(automationRules.id, other.id), eq(automationRules.workspaceId, workspaceId)
    ))
    const reordered = await tx.select().from(automationRules)
      .where(eq(automationRules.workspaceId, workspaceId))
      .orderBy(asc(automationRules.sortOrder), asc(automationRules.createdAt), asc(automationRules.id))
    return { moved: true, rules: reordered }
  })
  if (!outcome.moved) return outcome.rules.map(serializeAutomationRule)
  invalidateAutomationRuleCache(workspaceId)
  logAudit(workspaceId, user, 'automation.reordered', { ruleId, direction: result.data.direction })
  return outcome.rules.map(serializeAutomationRule)
})
