import { and, asc, automationRules, eq } from '@perch/db'
import { z } from 'zod'

const schema = z.object({ direction: z.enum(['up', 'down']) }).strict()

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const ruleId = getRouterParam(event, 'ruleId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) throw createError({ statusCode: 400, statusMessage: 'Invalid direction' })

  const rules = await useDb().query.automationRules.findMany({
    where: eq(automationRules.workspaceId, workspaceId),
    orderBy: [asc(automationRules.sortOrder), asc(automationRules.createdAt), asc(automationRules.id)]
  })
  const index = rules.findIndex(rule => rule.id === ruleId)
  if (index < 0) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })
  const otherIndex = result.data.direction === 'up' ? index - 1 : index + 1
  const other = rules[otherIndex]
  if (!other) return rules.map(serializeAutomationRule)

  const current = rules[index]!
  await useDb().transaction(async (tx) => {
    await tx.update(automationRules).set({ sortOrder: other.sortOrder, updatedAt: new Date() }).where(and(
      eq(automationRules.id, current.id), eq(automationRules.workspaceId, workspaceId)
    ))
    await tx.update(automationRules).set({ sortOrder: current.sortOrder, updatedAt: new Date() }).where(and(
      eq(automationRules.id, other.id), eq(automationRules.workspaceId, workspaceId)
    ))
  })
  invalidateAutomationRuleCache(workspaceId)
  logAudit(workspaceId, user, 'automation.reordered', { ruleId, direction: result.data.direction })

  const reordered = await useDb().query.automationRules.findMany({
    where: eq(automationRules.workspaceId, workspaceId),
    orderBy: [asc(automationRules.sortOrder), asc(automationRules.createdAt), asc(automationRules.id)]
  })
  return reordered.map(serializeAutomationRule)
})
