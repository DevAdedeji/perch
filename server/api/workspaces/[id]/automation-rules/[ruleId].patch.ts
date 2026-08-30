import { and, automationRules, eq } from '@perch/db'
import type { AutomationRuleConfig } from '@perch/shared'
import { z } from 'zod'

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  config: z.unknown().optional(),
  enabled: z.boolean().optional()
}).strict().refine(value => value.name !== undefined || value.config !== undefined || value.enabled !== undefined, {
  message: 'No changes provided'
})

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')!
  const ruleId = getRouterParam(event, 'ruleId')!
  const { user } = await requireMembership(event, workspaceId, { admin: true })
  const result = await readValidatedBody(event, body => schema.safeParse(body))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid automation', data: result.error.flatten() })
  }
  const existing = await useDb().query.automationRules.findFirst({
    where: and(eq(automationRules.id, ruleId), eq(automationRules.workspaceId, workspaceId))
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  let config: AutomationRuleConfig | undefined
  if (result.data.config !== undefined) {
    const configResult = parseAutomationConfig(existing.type, result.data.config)
    if (!configResult.success) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid automation settings', data: configResult.error.flatten() })
    }
    config = configResult.data as AutomationRuleConfig
    await assertAutomationReferences(workspaceId, existing.type, config)
  }

  const [updated] = await useDb().update(automationRules).set({
    ...(result.data.name !== undefined ? { name: result.data.name } : {}),
    ...(config !== undefined ? { config } : {}),
    ...(result.data.enabled !== undefined ? { enabled: result.data.enabled } : {}),
    updatedAt: new Date()
  }).where(and(eq(automationRules.id, ruleId), eq(automationRules.workspaceId, workspaceId))).returning()
  invalidateAutomationRuleCache(workspaceId)
  logAudit(workspaceId, user, 'automation.updated', { ruleId, name: updated!.name, changed: Object.keys(result.data) })
  return serializeAutomationRule(updated!)
})
