import { asc, automationRules, eq } from '@perch/db'

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  await requireMembership(event, workspaceId, { admin: true })
  const rules = await useDb().query.automationRules.findMany({
    where: eq(automationRules.workspaceId, workspaceId),
    orderBy: [asc(automationRules.sortOrder), asc(automationRules.createdAt), asc(automationRules.id)]
  })
  return rules.map(serializeAutomationRule)
})
