import { and, automationRules, eq } from '@perch/db'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const ruleId = getRouterParam(event, 'ruleId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  const [deleted] = await useDb().delete(automationRules).where(and(
    eq(automationRules.id, ruleId),
    eq(automationRules.workspaceId, workspaceId)
  )).returning()
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })
  invalidateAutomationRuleCache(workspaceId)
  logAudit(workspaceId, user, 'automation.deleted', { ruleId, name: deleted.name, type: deleted.type })
  setResponseStatus(event, 204)
})
