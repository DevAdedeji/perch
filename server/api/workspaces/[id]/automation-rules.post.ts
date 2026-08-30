import { and, automationRules, count, eq, sql, workspaces } from '@perch/db'
import { AUTOMATION_RULE_TYPES } from '@perch/shared'
import type { AutomationRuleConfig } from '@perch/shared'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  idempotency_key: z.string().uuid(),
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
  const db = useDb()
  const replay = await db.query.automationRules.findFirst({
    where: and(
      eq(automationRules.workspaceId, workspaceId),
      eq(automationRules.requestKey, result.data.idempotency_key)
    )
  })
  if (replay) return serializeAutomationRule(replay)

  const configResult = parseAutomationConfig(result.data.type, result.data.config)
  if (!configResult.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid automation settings', data: configResult.error.flatten() })
  }
  const config = configResult.data as AutomationRuleConfig
  await assertAutomationReferences(workspaceId, result.data.type, config)

  const outcome = await db.transaction(async (tx) => {
    const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.id, workspaceId)).for('update')
    if (!workspace) throw createError({ statusCode: 404, statusMessage: 'Workspace not found' })

    const existing = await tx.query.automationRules.findFirst({
      where: and(
        eq(automationRules.workspaceId, workspaceId),
        eq(automationRules.requestKey, result.data.idempotency_key)
      )
    })
    if (existing) return { rule: existing, created: false }

    const [aggregate] = await tx.select({
      total: count(),
      nextOrder: sql<number>`coalesce(max(${automationRules.sortOrder}), 0) + 10`
    }).from(automationRules).where(eq(automationRules.workspaceId, workspaceId))
    if (Number(aggregate?.total ?? 0) >= MAX_RULES) {
      throw createError({ statusCode: 400, statusMessage: `A workspace can have at most ${MAX_RULES} automations` })
    }

    const [rule] = await tx.insert(automationRules).values({
      workspaceId,
      requestKey: result.data.idempotency_key,
      name: result.data.name,
      type: result.data.type,
      config,
      enabled: result.data.enabled,
      sortOrder: Number(aggregate?.nextOrder ?? 10)
    }).returning()
    return { rule: rule!, created: true }
  })
  invalidateAutomationRuleCache(workspaceId)
  if (outcome.created) {
    logAudit(workspaceId, user, 'automation.created', { ruleId: outcome.rule.id, name: outcome.rule.name, type: outcome.rule.type })
    setResponseStatus(event, 201)
  }
  return serializeAutomationRule(outcome.rule)
})
