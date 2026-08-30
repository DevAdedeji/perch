import { automationRules, count, eq, sql } from '@perch/db'
import { AUTOMATION_RULE_TYPES } from '@perch/shared'
import type { AutomationRuleConfig } from '@perch/shared'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(AUTOMATION_RULE_TYPES),
  config: z.unknown(),
  enabled: z.boolean().default(true)
}).strict()
const MAX_RULES = 30

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid automation', data: result.error.flatten() })
  }
  const configResult = parseAutomationConfig(result.data.type, result.data.config)
  if (!configResult.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid automation settings', data: configResult.error.flatten() })
  }
  const config = configResult.data as AutomationRuleConfig
  await assertAutomationReferences(workspaceId, result.data.type, config)

  const db = useDb()
  const [aggregate] = await db.select({
    total: count(),
    nextOrder: sql<number>`coalesce(max(${automationRules.sortOrder}), 0) + 10`
  }).from(automationRules).where(eq(automationRules.workspaceId, workspaceId))
  const total = Number(aggregate?.total ?? 0)
  const nextOrder = Number(aggregate?.nextOrder ?? 10)
  if (total >= MAX_RULES) {
    throw createError({ statusCode: 400, statusMessage: `A workspace can have at most ${MAX_RULES} automations` })
  }

  const [rule] = await db.insert(automationRules).values({
    workspaceId,
    name: result.data.name,
    type: result.data.type,
    config,
    enabled: result.data.enabled,
    sortOrder: nextOrder
  }).returning()
  invalidateAutomationRuleCache(workspaceId)
  logAudit(workspaceId, user, 'automation.created', { ruleId: rule!.id, name: rule!.name, type: rule!.type })
  setResponseStatus(event, 201)
  return serializeAutomationRule(rule!)
})
